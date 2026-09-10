CREATE TABLE IF NOT EXISTS refund_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  actor_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  provider_refund_id text,
  provider_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refund_operations_actor_created_idx
  ON refund_operations(actor_profile_id, created_at);

-- The Supabase direct-client RLS policies for this table and the associated
-- staff comment table live in supabase_rls.sql, after its helper functions.