ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS prohibited_items_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prohibited_items_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS prohibited_items_policy_version text;