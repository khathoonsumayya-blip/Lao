CREATE TABLE IF NOT EXISTS driver_preferences (
  driver_id uuid PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  notification_sound boolean NOT NULL DEFAULT true,
  vibration boolean NOT NULL DEFAULT true,
  navigation_app text NOT NULL DEFAULT 'system',
  preferred_max_range_miles integer NOT NULL DEFAULT 12,
  working_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_preferences_navigation_app_check CHECK (navigation_app IN ('google_maps', 'apple_maps', 'waze', 'system')),
  CONSTRAINT driver_preferences_range_check CHECK (preferred_max_range_miles IN (3, 5, 8, 12))
);

CREATE TABLE IF NOT EXISTS dispatch_settings (
  id text PRIMARY KEY DEFAULT 'dispatch',
  initial_radius_miles integer NOT NULL DEFAULT 3,
  initial_duration_seconds integer NOT NULL DEFAULT 30,
  expansion_stages jsonb NOT NULL DEFAULT '[{"radiusMiles":5,"durationSeconds":30},{"radiusMiles":8,"durationSeconds":60},{"radiusMiles":12,"durationSeconds":480}]'::jsonb,
  maximum_pickup_eta_minutes integer NOT NULL DEFAULT 15,
  total_expiration_seconds integer NOT NULL DEFAULT 600,
  updated_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_settings_positive_check CHECK (initial_radius_miles > 0 AND initial_duration_seconds > 0 AND maximum_pickup_eta_minutes > 0 AND total_expiration_seconds > 0)
);

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz;
UPDATE deliveries SET dispatch_started_at = created_at
  WHERE delivery_status = 'searching_driver' AND dispatch_started_at IS NULL;