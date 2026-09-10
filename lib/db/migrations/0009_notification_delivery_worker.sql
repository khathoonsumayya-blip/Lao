ALTER TABLE notification_attempts
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_attempts_lease_idx
  ON notification_attempts(status, lease_expires_at);