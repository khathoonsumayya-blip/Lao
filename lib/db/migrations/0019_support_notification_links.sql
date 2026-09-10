ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "support_ticket_id" uuid REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "driver_incident_id" uuid REFERENCES "driver_incidents"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "notifications_support_ticket_idx" ON "notifications" ("support_ticket_id");
CREATE INDEX IF NOT EXISTS "notifications_driver_incident_idx" ON "notifications" ("driver_incident_id");