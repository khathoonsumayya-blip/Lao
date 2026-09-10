ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES delivery_quotes(id) ON DELETE RESTRICT;

ALTER TABLE delivery_verifications
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE TABLE IF NOT EXISTS delivery_coordination_events (
  cursor bigserial PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_coordination_events_delivery_cursor_idx
  ON delivery_coordination_events(delivery_id, cursor);
CREATE INDEX IF NOT EXISTS delivery_coordination_events_customer_cursor_idx
  ON delivery_coordination_events(customer_id, cursor);
CREATE INDEX IF NOT EXISTS delivery_coordination_events_driver_cursor_idx
  ON delivery_coordination_events(driver_id, cursor);

CREATE TABLE IF NOT EXISTS notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordination_event_cursor bigint NOT NULL REFERENCES delivery_coordination_events(cursor) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'in_app',
  status text NOT NULL DEFAULT 'pending',
  attempts text NOT NULL DEFAULT '0',
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_attempts_retry_idx
  ON notification_attempts(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS notification_attempts_delivery_idx
  ON notification_attempts(delivery_id, created_at);