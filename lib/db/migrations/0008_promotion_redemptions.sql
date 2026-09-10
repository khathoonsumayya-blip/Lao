CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL,
  delivery_id uuid NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE,
  promotion_code text NOT NULL,
  savings_amount numeric(10, 2) NOT NULL CHECK (savings_amount >= 0),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promotion_redemptions_redeemed_code_idx
  ON promotion_redemptions(redeemed_at, promotion_code);