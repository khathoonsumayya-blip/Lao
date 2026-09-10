-- Dedicated admin operations data. These fields remain staff-visible only through
-- authenticated server routes; customer ticket creation continues to use the
-- existing support_tickets contract.
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_ticket_comments_ticket_created_idx
  ON support_ticket_comments(ticket_id, created_at);