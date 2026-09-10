ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS checkout_request_key text;
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_checkout_request_key_unique
  ON deliveries(checkout_request_key)
  WHERE checkout_request_key IS NOT NULL;