import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeTelegramHtml(value: unknown): string {
  return String(value ?? 'N/A')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return jsonResponse({ error: 'Authentication is required.' }, 401);
  }
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt === authorization) {
    return jsonResponse({ error: 'A valid bearer token is required.' }, 401);
  }

  let orderId: string;
  let proofPhoto: File | null;
  let latitude: number;
  let longitude: number;
  if (request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) {
    let body: FormData;
    try {
      body = await request.formData();
    } catch {
      return jsonResponse({ error: 'Request body must contain a valid proof photo upload.' }, 400);
    }

    const formOrderId = body.get('orderId');
    const uploadedPhoto = body.get('proof');
    const latitudeValue = body.get('latitude');
    const longitudeValue = body.get('longitude');
    orderId = typeof formOrderId === 'string' ? formOrderId : '';
    proofPhoto = uploadedPhoto instanceof File ? uploadedPhoto : null;
    latitude = typeof latitudeValue === 'string' && latitudeValue.trim()
      ? Number(latitudeValue)
      : Number.NaN;
    longitude = typeof longitudeValue === 'string' && longitudeValue.trim()
      ? Number(longitudeValue)
      : Number.NaN;
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON or multipart form data.' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return jsonResponse({ error: 'A valid order ID and proof photo are required.' }, 400);
    }

    const { orderId: legacyOrderId, proofBase64, latitude: legacyLatitude, longitude: legacyLongitude } =
      body as {
        orderId?: unknown;
        proofBase64?: unknown;
        latitude?: unknown;
        longitude?: unknown;
      };
    if (
      (typeof legacyOrderId !== 'string' && typeof legacyOrderId !== 'number') ||
      typeof proofBase64 !== 'string' ||
      proofBase64.length === 0 ||
      proofBase64.length > 12_000_000
    ) {
      return jsonResponse({ error: 'A valid order ID and proof photo are required.' }, 400);
    }

    let photoBytes: Uint8Array;
    try {
      const binary = atob(proofBase64);
      photoBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
      return jsonResponse({ error: 'The proof photo is not valid base64 data.' }, 400);
    }
    if (photoBytes.length === 0 || photoBytes.length > 9_000_000) {
      return jsonResponse({ error: 'The proof photo must be smaller than 9 MB.' }, 413);
    }

    orderId = String(legacyOrderId);
    proofPhoto = new File([photoBytes], 'delivery-proof.jpg', { type: 'image/jpeg' });
    latitude = typeof legacyLatitude === 'number' ? legacyLatitude : Number.NaN;
    longitude = typeof legacyLongitude === 'number' ? legacyLongitude : Number.NaN;
  }

  if (proofPhoto && proofPhoto.size > 9_000_000) {
    return jsonResponse({ error: 'The proof photo must be smaller than 9 MB.' }, 413);
  }
  if (
    !orderId.trim() ||
    !proofPhoto ||
    proofPhoto.size === 0 ||
    proofPhoto.type !== 'image/jpeg' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return jsonResponse({ error: 'A valid order ID, proof photo, and location are required.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!supabaseUrl || !supabaseAnonKey || !botToken || !chatId) {
    console.error('Required delivery proof function environment variables are missing.');
    return jsonResponse({ error: 'Delivery proof service is not configured.' }, 500);
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user?.email) {
      return jsonResponse({ error: 'Your login has expired. Please sign in again.' }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('rider_id')
      .eq('email', user.email)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.rider_id) {
      return jsonResponse({ error: 'Rider profile not found.' }, 403);
    }

    const { data: rider, error: riderError } = await supabase
      .from('riders')
      .select('name')
      .eq('id', profile.rider_id)
      .maybeSingle();
    if (riderError) throw riderError;
    const riderName = rider?.name || user.email.split('@')[0];

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, item_id, barcode, sender_name, receiver_name, receiver_address')
      .eq('id', orderId)
      .eq('deliver_rider_id', profile.rider_id)
      .eq('status', 'On Way')
      .eq('is_deleted', false)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      return jsonResponse({ error: 'Order is no longer available for delivery.' }, 409);
    }

    const { data: updatedRider, error: locationError } = await supabase
      .from('riders')
      .update({
        last_latitude: latitude,
        last_longitude: longitude,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', profile.rider_id)
      .select('id')
      .maybeSingle();
    if (locationError) throw locationError;
    if (!updatedRider) {
      throw new Error('Rider record was not found while saving the delivery location.');
    }

    const caption = [
      `Rider: ${escapeTelegramHtml(riderName)}`,
      `Item ID: <code>${escapeTelegramHtml(order.item_id)}</code>`,
      `Barcode: <code>${escapeTelegramHtml(order.barcode)}</code>`,
      `Sender: ${escapeTelegramHtml(order.sender_name)}`,
      `Receiver: ${escapeTelegramHtml(order.receiver_name)}`,
      `Address: ${escapeTelegramHtml(order.receiver_address)}`,
    ].join('\n');
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('photo', proofPhoto, `delivery-${order.id}.jpg`);

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
    const telegramBody = await telegramResponse.text();
    let telegramResult: { ok?: boolean; description?: string };
    try {
      telegramResult = JSON.parse(telegramBody);
    } catch {
      throw new Error(`Telegram returned an invalid response (HTTP ${telegramResponse.status}).`);
    }
    if (!telegramResponse.ok || !telegramResult.ok) {
      throw new Error(telegramResult.description ?? `Telegram request failed (HTTP ${telegramResponse.status}).`);
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({ status: 'Delivered', latitude, longitude })
      .eq('id', order.id)
      .eq('deliver_rider_id', profile.rider_id)
      .eq('status', 'On Way')
      .eq('is_deleted', false)
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedOrder) {
      throw new Error('Proof was sent to Telegram, but the order status could not be updated.');
    }

    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected delivery proof error.';
    console.error('Delivery proof failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
