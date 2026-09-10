-- Controlled driver verification adjudication state. Status values are enforced
-- by the application to preserve the existing lifecycle.
ALTER TABLE driver_applications
  ADD COLUMN IF NOT EXISTS background_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS background_check_reference text,
  ADD COLUMN IF NOT EXISTS background_check_reason text,
  ADD COLUMN IF NOT EXISTS mvr_check_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS mvr_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS mvr_check_reference text,
  ADD COLUMN IF NOT EXISTS mvr_check_reason text;