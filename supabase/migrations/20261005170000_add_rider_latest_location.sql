ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS last_latitude double precision,
  ADD COLUMN IF NOT EXISTS last_longitude double precision,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
