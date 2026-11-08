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

function escapeTelegramHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function normalizeBranch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function parsePickupChannels(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('TELEGRAM_PICKUP_CHANNELS must be a valid JSON object.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('TELEGRAM_PICKUP_CHANNELS must be a JSON object of branch names and channel IDs.');
  }

  const channels = new Map<string, string>();
  for (const [branch, channelId] of Object.entries(parsed)) {
    const normalizedBranch = normalizeBranch(branch);
    if (!normalizedBranch || typeof channelId !== 'string' || !channelId.trim()) {
      throw new Error('TELEGRAM_PICKUP_CHANNELS contains an invalid branch or channel ID.');
    }
    if (channels.has(normalizedBranch)) {
      throw new Error('TELEGRAM_PICKUP_CHANNELS contains duplicate branch names ignoring case.');
    }
    channels.set(normalizedBranch, channelId.trim());
  }
  return channels;
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonResponse({ error: 'A valid pickup ID and proof photo are required.' }, 400);
  }

  const { pickupId, proofBase64, proofMimeType } = body as {
    pickupId?: unknown;
    proofBase64?: unknown;
    proofMimeType?: unknown;
  };
  if (
    (typeof pickupId !== 'string' && typeof pickupId !== 'number') ||
    typeof proofBase64 !== 'string' ||
    proofBase64.length === 0 ||
    proofBase64.length > 12_000_000 ||
    (proofMimeType !== 'image/jpeg' && proofMimeType !== 'image/png')
  ) {
    return jsonResponse({ error: 'A valid pickup ID and JPEG or PNG proof photo are required.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const pickupChannelsConfig = Deno.env.get('TELEGRAM_PICKUP_CHANNELS');
  if (!supabaseUrl || !supabaseAnonKey || !botToken || !pickupChannelsConfig) {
    console.error('Required pickup proof function environment variables are missing.');
    return jsonResponse({ error: 'Pickup proof service is not configured.' }, 500);
  }

  try {
    const pickupChannels = parsePickupChannels(pickupChannelsConfig);
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

    const { data: pickup, error: pickupError } = await supabase
      .from('pickups')
      .select('id, sender_id, rider_id, status')
      .eq('id', pickupId)
      .eq('rider_id', profile.rider_id)
      .in('status', ['Assigned', 'Assgined'])
      .maybeSingle();
    if (pickupError) throw pickupError;
    if (!pickup) {
      return jsonResponse({ error: 'Pickup is no longer assigned to this rider.' }, 409);
    }

    const [
      { data: rider, error: riderError },
      { data: sender, error: senderError },
    ] = await Promise.all([
      supabase.from('riders').select('name, branch').eq('id', profile.rider_id).maybeSingle(),
      supabase.from('senders').select('name').eq('id', pickup.sender_id).maybeSingle(),
    ]);
    if (riderError) throw riderError;
    if (senderError) throw senderError;
    const riderName = rider?.name?.trim();
    const riderBranch = typeof rider?.branch === 'string' ? rider.branch.trim() : '';
    const senderName = sender?.name?.trim();
    if (!riderName || !riderBranch || !senderName) {
      return jsonResponse({ error: 'Rider name, rider branch, or sender name could not be found.' }, 422);
    }
    const pickupChatId = pickupChannels.get(normalizeBranch(riderBranch));
    if (!pickupChatId) {
      return jsonResponse({ error: `No pickup Telegram channel is configured for branch "${riderBranch}".` }, 422);
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

    const form = new FormData();
    form.append('chat_id', pickupChatId);
    form.append(
      'caption',
      `Rider: ${escapeTelegramHtml(riderName)}\nBranch: ${escapeTelegramHtml(riderBranch)}\nSender: ${escapeTelegramHtml(senderName)}`,
    );
    form.append('parse_mode', 'HTML');
    const photoBuffer = new ArrayBuffer(photoBytes.byteLength);
    new Uint8Array(photoBuffer).set(photoBytes);
    const extension = proofMimeType === 'image/png' ? 'png' : 'jpg';
    form.append(
      'photo',
      new Blob([photoBuffer], { type: proofMimeType }),
      `pickup-${pickup.id}.${extension}`,
    );

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

    const { data: updatedPickup, error: updateError } = await supabase
      .from('pickups')
      .update({ status: 'Picked Up' })
      .eq('id', pickup.id)
      .eq('rider_id', profile.rider_id)
      .in('status', ['Assigned', 'Assgined'])
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedPickup) {
      throw new Error('Proof was sent to Telegram, but the pickup status could not be updated.');
    }

    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected pickup proof error.';
    console.error('Pickup proof failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
