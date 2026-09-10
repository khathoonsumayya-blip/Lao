ALTER TABLE "support_tickets"
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "resolved_by_profile_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL;

-- "escalated" was a legacy UI-only state. Keep those tickets actionable in
-- the canonical three-state workflow rather than emitting an invalid API enum.
UPDATE "support_tickets" SET "status" = 'in_progress' WHERE "status" = 'escalated';

CREATE INDEX IF NOT EXISTS "support_tickets_resolved_by_idx"
  ON "support_tickets" ("resolved_by_profile_id");

ALTER TABLE "driver_incidents"
  ADD COLUMN IF NOT EXISTS "resolution" text,
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "resolved_by_profile_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "driver_incidents_resolved_by_idx"
  ON "driver_incidents" ("resolved_by_profile_id");