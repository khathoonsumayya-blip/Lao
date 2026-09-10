CREATE TABLE IF NOT EXISTS general_settings (
  id text PRIMARY KEY DEFAULT 'general' CHECK (id = 'general'),
  business_name text NOT NULL,
  app_name text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  business_email text NOT NULL,
  support_email text NOT NULL,
  support_phone text NOT NULL DEFAULT '',
  business_address text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  default_currency text NOT NULL DEFAULT 'USD',
  country text NOT NULL DEFAULT 'US',
  time_zone text NOT NULL DEFAULT 'America/New_York',
  date_format text NOT NULL DEFAULT 'MM/dd/yyyy',
  distance_unit text NOT NULL DEFAULT 'mi',
  updated_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);