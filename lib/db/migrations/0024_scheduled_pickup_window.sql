ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS scheduled_pickup_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_pickup_end_at timestamptz;

ALTER TABLE delivery_quotes
  ADD COLUMN IF NOT EXISTS scheduled_pickup_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_pickup_end_at timestamptz;

ALTER TABLE deliveries
  DROP CONSTRAINT IF EXISTS deliveries_scheduled_window_check;
ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_scheduled_window_check
  CHECK (
    (scheduled_pickup_start_at IS NULL AND scheduled_pickup_end_at IS NULL)
    OR (scheduled_pickup_start_at IS NOT NULL AND scheduled_pickup_end_at IS NOT NULL
        AND scheduled_pickup_start_at < scheduled_pickup_end_at)
  );

ALTER TABLE delivery_quotes
  DROP CONSTRAINT IF EXISTS delivery_quotes_scheduled_window_check;
ALTER TABLE delivery_quotes
  ADD CONSTRAINT delivery_quotes_scheduled_window_check
  CHECK (
    (scheduled_pickup_start_at IS NULL AND scheduled_pickup_end_at IS NULL)
    OR (scheduled_pickup_start_at IS NOT NULL AND scheduled_pickup_end_at IS NOT NULL
        AND scheduled_pickup_start_at < scheduled_pickup_end_at)
  );