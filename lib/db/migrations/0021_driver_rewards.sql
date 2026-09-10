CREATE TABLE IF NOT EXISTS driver_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  type text NOT NULL CHECK (type IN ('on_time', 'weekend', 'streak', 'manual_performance')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  performance_period_start timestamptz,
  performance_period_end timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'reversed')),
  issued_by_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  approved_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  paid_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  paid_at timestamptz,
  reversed_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversal_reason text,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  request_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (performance_period_start IS NULL OR performance_period_end IS NULL OR performance_period_start <= performance_period_end),
  CHECK ((approved_at IS NULL) = (approved_by_profile_id IS NULL)),
  CHECK ((paid_at IS NULL) = (paid_by_profile_id IS NULL)),
  CHECK ((reversed_at IS NULL) = (reversed_by_profile_id IS NULL)),
  CHECK (
    (status = 'pending' AND approved_at IS NULL AND paid_at IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
    OR (status = 'approved' AND approved_at IS NOT NULL AND paid_at IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
    OR (status = 'paid' AND approved_at IS NOT NULL AND paid_at IS NOT NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
    OR (status = 'reversed' AND reversed_at IS NOT NULL AND reversal_reason IS NOT NULL AND length(btrim(reversal_reason)) >= 3)
  )
);
CREATE INDEX IF NOT EXISTS driver_bonuses_driver_created_idx ON driver_bonuses(driver_id, created_at);
CREATE INDEX IF NOT EXISTS driver_bonuses_status_created_idx ON driver_bonuses(status, created_at);

-- Reconcile databases where an earlier development draft of this migration
-- created the rewards tables before the final constraints were added.
ALTER TABLE driver_bonuses ADD COLUMN IF NOT EXISTS request_fingerprint text;
UPDATE driver_bonuses
SET request_fingerprint = idempotency_key
WHERE request_fingerprint IS NULL;
ALTER TABLE driver_bonuses ALTER COLUMN request_fingerprint SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_amount_bounds_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_amount_bounds_check CHECK (amount_cents > 0 AND amount_cents <= 100000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_currency_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_currency_check CHECK (currency = 'USD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_type_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_type_check CHECK (type IN ('on_time', 'weekend', 'streak', 'manual_performance'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_reason_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_note_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_note_check CHECK (note IS NULL OR length(note) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_status_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_status_check CHECK (status IN ('pending', 'approved', 'paid', 'reversed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_idempotency_key_length_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_idempotency_key_length_check CHECK (length(idempotency_key) BETWEEN 1 AND 255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_period_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_period_check CHECK (performance_period_start IS NULL OR performance_period_end IS NULL OR performance_period_start <= performance_period_end);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_approved_pair_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_approved_pair_check CHECK ((approved_at IS NULL) = (approved_by_profile_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_paid_pair_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_paid_pair_check CHECK ((paid_at IS NULL) = (paid_by_profile_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_reversed_pair_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_reversed_pair_check CHECK ((reversed_at IS NULL) = (reversed_by_profile_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonuses_lifecycle_check' AND conrelid = 'driver_bonuses'::regclass) THEN
    ALTER TABLE driver_bonuses ADD CONSTRAINT driver_bonuses_lifecycle_check CHECK (
      (status = 'pending' AND approved_at IS NULL AND paid_at IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
      OR (status = 'approved' AND approved_at IS NOT NULL AND paid_at IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
      OR (status = 'paid' AND approved_at IS NOT NULL AND paid_at IS NOT NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
      OR (status = 'reversed' AND reversed_at IS NOT NULL AND reversal_reason IS NOT NULL AND length(btrim(reversal_reason)) >= 3)
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS driver_bonus_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bonus_id uuid NOT NULL REFERENCES driver_bonuses(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('created', 'approved', 'paid', 'reversed')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('pending', 'approved', 'paid', 'reversed')),
  to_status text CHECK (to_status IS NULL OR to_status IN ('pending', 'approved', 'paid', 'reversed')),
  actor_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_bonus_events_bonus_created_idx ON driver_bonus_events(bonus_id, created_at);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonus_events_type_check' AND conrelid = 'driver_bonus_events'::regclass) THEN
    ALTER TABLE driver_bonus_events ADD CONSTRAINT driver_bonus_events_type_check CHECK (type IN ('created', 'approved', 'paid', 'reversed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonus_events_from_status_check' AND conrelid = 'driver_bonus_events'::regclass) THEN
    ALTER TABLE driver_bonus_events ADD CONSTRAINT driver_bonus_events_from_status_check CHECK (from_status IS NULL OR from_status IN ('pending', 'approved', 'paid', 'reversed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_bonus_events_to_status_check' AND conrelid = 'driver_bonus_events'::regclass) THEN
    ALTER TABLE driver_bonus_events ADD CONSTRAINT driver_bonus_events_to_status_check CHECK (to_status IS NULL OR to_status IN ('pending', 'approved', 'paid', 'reversed'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS driver_delivery_offer_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  offered_at timestamptz NOT NULL DEFAULT now(),
  offer_expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  response text NOT NULL DEFAULT 'offered' CHECK (response IN ('offered', 'accepted', 'declined', 'expired')),
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, driver_id),
  CHECK ((response = 'offered' AND responded_at IS NULL) OR (response IN ('accepted', 'declined', 'expired') AND responded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS driver_offer_attempt_driver_offered_idx ON driver_delivery_offer_attempts(driver_id, offered_at);
ALTER TABLE driver_delivery_offer_attempts ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;
ALTER TABLE driver_delivery_offer_attempts DROP CONSTRAINT IF EXISTS driver_delivery_offer_attempts_check;
ALTER TABLE driver_delivery_offer_attempts DROP CONSTRAINT IF EXISTS driver_offer_attempt_response_timestamp_check;
UPDATE driver_delivery_offer_attempts
SET
  offer_expires_at = COALESCE(offer_expires_at, offered_at + interval '2 minutes'),
  responded_at = CASE
    WHEN response = 'expired' AND responded_at IS NULL THEN COALESCE(offer_expires_at, offered_at + interval '2 minutes')
    ELSE responded_at
  END
WHERE offer_expires_at IS NULL OR (response = 'expired' AND responded_at IS NULL);
ALTER TABLE driver_delivery_offer_attempts ALTER COLUMN offer_expires_at SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_offer_attempt_response_check' AND conrelid = 'driver_delivery_offer_attempts'::regclass) THEN
    ALTER TABLE driver_delivery_offer_attempts ADD CONSTRAINT driver_offer_attempt_response_check CHECK (response IN ('offered', 'accepted', 'declined', 'expired'));
  END IF;
END
$$;
ALTER TABLE driver_delivery_offer_attempts
ADD CONSTRAINT driver_offer_attempt_response_timestamp_check CHECK (
  (response = 'offered' AND responded_at IS NULL)
  OR (response IN ('accepted', 'declined', 'expired') AND responded_at IS NOT NULL)
);

-- Ledger records are evidence, never mutable operational state.
CREATE OR REPLACE FUNCTION reject_driver_bonus_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'driver_bonus_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS driver_bonus_events_no_update ON driver_bonus_events;
DROP TRIGGER IF EXISTS driver_bonus_events_no_delete ON driver_bonus_events;
CREATE TRIGGER driver_bonus_events_no_update BEFORE UPDATE ON driver_bonus_events FOR EACH ROW EXECUTE FUNCTION reject_driver_bonus_event_mutation();
CREATE TRIGGER driver_bonus_events_no_delete BEFORE DELETE ON driver_bonus_events FOR EACH ROW EXECUTE FUNCTION reject_driver_bonus_event_mutation();

-- Supabase-specific RLS policies live in supabase_rls.sql, alongside the
-- current_profile_id/current_driver_id helper functions they depend on.