import { supabase } from './supabase';

type UpdateOrderStatusOptions = {
  orderId: string | number;
  riderId: string | number;
  currentStatus: string;
  nextStatus: string;
};

export async function updateOrderStatus({
  orderId,
  riderId,
  currentStatus,
  nextStatus,
}: UpdateOrderStatusOptions) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('history')
    .eq('id', orderId)
    .eq('deliver_rider_id', riderId)
    .eq('status', currentStatus)
    .eq('is_deleted', false)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) throw new Error('Order is no longer available for status update.');
  if (order.history != null && !Array.isArray(order.history)) {
    throw new Error('Order history must be a JSON array.');
  }

  const { data: rider, error: riderError } = await supabase
    .from('riders')
    .select('name')
    .eq('id', riderId)
    .maybeSingle();

  if (riderError) throw riderError;
  const operator = rider?.name?.trim();
  if (!operator) throw new Error('Rider name is required to record order history.');

  const history = order.history ?? [];
  const { data, error: updateError } = await supabase
    .from('orders')
    .update({
      status: nextStatus,
      history: [
        ...history,
        {
          timestamp: new Date().toISOString(),
          action: 'Order Updated',
          operator,
          note: `Status: "${currentStatus}" ➔ "${nextStatus}"`,
        },
      ],
    })
    .eq('id', orderId)
    .eq('deliver_rider_id', riderId)
    .eq('status', currentStatus)
    .eq('is_deleted', false)
    .select('id')
    .maybeSingle();

  if (updateError) throw updateError;
  if (!data) throw new Error('Order status changed before the history could be saved.');

  return data;
}

type RecordOrderStatusHistoryOptions = {
  orderId: string | number;
  riderId: string | number;
  previousStatus: string;
  currentStatus: string;
};

export async function recordOrderStatusHistory({
  orderId,
  riderId,
  previousStatus,
  currentStatus,
}: RecordOrderStatusHistoryOptions) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('history')
    .eq('id', orderId)
    .eq('deliver_rider_id', riderId)
    .eq('status', currentStatus)
    .eq('is_deleted', false)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) throw new Error('Delivered order could not be found to record its history.');
  if (order.history != null && !Array.isArray(order.history)) {
    throw new Error('Order history must be a JSON array.');
  }

  const { data: rider, error: riderError } = await supabase
    .from('riders')
    .select('name')
    .eq('id', riderId)
    .maybeSingle();

  if (riderError) throw riderError;
  const operator = rider?.name?.trim();
  if (!operator) throw new Error('Rider name is required to record order history.');

  const history = order.history ?? [];
  const note = `Status: "${previousStatus}" ➔ "${currentStatus}"`;
  const timestamp = new Date().toISOString();
  const lastEntry = history.at(-1);
  if (
    lastEntry &&
    typeof lastEntry === 'object' &&
    'timestamp' in lastEntry &&
    typeof lastEntry.timestamp === 'string' &&
    Math.abs(Date.parse(timestamp) - Date.parse(lastEntry.timestamp)) < 60_000 &&
    'action' in lastEntry &&
    lastEntry.action === 'Order Updated' &&
    'operator' in lastEntry &&
    lastEntry.operator === operator &&
    'note' in lastEntry &&
    lastEntry.note === note
  ) {
    return;
  }

  const { data, error: updateError } = await supabase
    .from('orders')
    .update({
      history: [
        ...history,
        {
          timestamp,
          action: 'Order Updated',
          operator,
          note,
        },
      ],
    })
    .eq('id', orderId)
    .eq('deliver_rider_id', riderId)
    .eq('status', currentStatus)
    .eq('is_deleted', false)
    .select('id')
    .maybeSingle();

  if (updateError) throw updateError;
  if (!data) throw new Error('Order changed before its history could be saved.');
}
