ALTER TABLE "driver_incidents"
  ADD COLUMN IF NOT EXISTS "priority" text NOT NULL DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS "driver_incidents_priority_updated_idx"
  ON "driver_incidents" ("priority", "updated_at");