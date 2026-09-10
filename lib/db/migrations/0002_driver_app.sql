-- Driver App operational records. Sensitive identity documents remain private
-- object-storage assets; only safe metadata and document references belong here.
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS driver_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL UNIQUE REFERENCES drivers(id) ON DELETE CASCADE,
  avatar_path text,
  license_state text,
  license_last_four text,
  insurance_provider text,
  insurance_expires_at timestamptz,
  background_check_status text NOT NULL DEFAULT 'not_started',
  safety_acknowledged_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_applications_driver_idx ON driver_applications(driver_id);

CREATE TABLE IF NOT EXISTS delivery_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts text NOT NULL DEFAULT '0',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_verifications_delivery_idx ON delivery_verifications(delivery_id);

CREATE TABLE IF NOT EXISTS driver_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  category text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_incidents_driver_created_idx ON driver_incidents(driver_id, created_at);
CREATE INDEX IF NOT EXISTS driver_incidents_delivery_idx ON driver_incidents(delivery_id);