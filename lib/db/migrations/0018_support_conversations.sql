ALTER TABLE "driver_incidents"
  ADD COLUMN IF NOT EXISTS "assigned_profile_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "driver_incidents_assigned_updated_idx"
  ON "driver_incidents" ("assigned_profile_id", "updated_at");

CREATE TABLE IF NOT EXISTS "support_conversation_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "support_ticket_id" uuid REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "driver_incident_id" uuid REFERENCES "driver_incidents"("id") ON DELETE CASCADE,
  "author_profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "visibility" text NOT NULL DEFAULT 'requester',
  "client_request_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_conversation_entry_one_source CHECK (
    (support_ticket_id IS NOT NULL)::integer + (driver_incident_id IS NOT NULL)::integer = 1
  )
);
CREATE INDEX IF NOT EXISTS "support_conversation_ticket_created_idx" ON "support_conversation_entries" ("support_ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "support_conversation_incident_created_idx" ON "support_conversation_entries" ("driver_incident_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "support_conversation_author_request_unique"
  ON "support_conversation_entries" ("author_profile_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;