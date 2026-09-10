-- Idempotent Stripe webhook ledger for existing Anything Anywhere databases.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payment_intent_id text NOT NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_payment_created_idx
  ON payment_webhook_events(payment_id, created_at);
CREATE INDEX IF NOT EXISTS payment_webhook_events_delivery_created_idx
  ON payment_webhook_events(delivery_id, created_at);