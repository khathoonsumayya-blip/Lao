-- Post-approval driver profile review, private-document metadata, and the
-- immutable vehicle data associated with an accepted delivery.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS vehicle_year text;

ALTER TABLE driver_applications
  ADD COLUMN IF NOT EXISTS pending_profile_changes jsonb,
  ADD COLUMN IF NOT EXISTS pending_profile_review_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS pending_profile_review_reason text,
  ADD COLUMN IF NOT EXISTS pending_profile_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_profile_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_profile_reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS driver_vehicle_snapshot jsonb;