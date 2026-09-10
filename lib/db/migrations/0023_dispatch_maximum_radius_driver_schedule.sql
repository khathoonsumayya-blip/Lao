ALTER TABLE driver_preferences
  ADD COLUMN IF NOT EXISTS working_hours_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE dispatch_settings
  ADD COLUMN IF NOT EXISTS maximum_radius_miles integer NOT NULL DEFAULT 12;

ALTER TABLE dispatch_settings
  DROP CONSTRAINT IF EXISTS dispatch_settings_maximum_radius_check;
ALTER TABLE dispatch_settings
  ADD CONSTRAINT dispatch_settings_maximum_radius_check
  CHECK (maximum_radius_miles > 0 AND maximum_radius_miles <= 100);