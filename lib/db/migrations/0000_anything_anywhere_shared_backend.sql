-- Canonical PostgreSQL/Supabase schema for Anything Anywhere.
-- Drizzle schema is the runtime source of truth; this migration is supplied for
-- SQL-first Supabase deployments. Run it before supabase_rls.sql.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE profile_role AS ENUM ('customer','driver','dispatcher','support','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE delivery_status AS ENUM (
    'draft','quoted','payment_pending','paid','searching_driver','driver_assigned',
    'driver_en_route_pickup','driver_arrived_pickup','pickup_verified','picked_up',
    'in_transit','driver_arrived_delivery','delivery_verification_pending',
    'delivered','cancelled','failed','refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('test_pending','test_paid','pending','authorized','paid','failed','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid NOT NULL UNIQUE,
  role profile_role NOT NULL DEFAULT 'customer', first_name text NOT NULL, last_name text NOT NULL,
  email text NOT NULL UNIQUE, password_hash text, email_verified_at timestamptz, phone_verified_at timestamptz,
  phone text, avatar_url text, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  user_agent text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label text NOT NULL, full_address text NOT NULL, street text, city text, state text, postal_code text, country text,
  latitude double precision, longitude double precision, instructions text, is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL, phone text NOT NULL, relationship text, address_id uuid REFERENCES customer_addresses(id) ON DELETE SET NULL,
  instructions text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  onboarding_status text NOT NULL DEFAULT 'pending', availability_status text NOT NULL DEFAULT 'offline',
  approval_status text NOT NULL DEFAULT 'pending', vehicle_type text, vehicle_make text, vehicle_model text,
  vehicle_color text, license_plate text, rating double precision NOT NULL DEFAULT 5, total_deliveries text NOT NULL DEFAULT '0',
  current_latitude double precision, current_longitude double precision, last_location_update timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  document_type text NOT NULL, storage_path text NOT NULL, verification_status text NOT NULL DEFAULT 'pending',
  expiry_date date, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_delivery_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE, customer_id uuid NOT NULL REFERENCES profiles(id), driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  pickup_address text NOT NULL, pickup_contact_name text NOT NULL, pickup_contact_phone text NOT NULL, pickup_instructions text,
  pickup_latitude double precision, pickup_longitude double precision, dropoff_address text NOT NULL,
  recipient_name text NOT NULL, recipient_phone text NOT NULL, delivery_instructions text,
  delivery_latitude double precision, delivery_longitude double precision, package_category text NOT NULL,
  package_description text, weight_category text NOT NULL, size_category text NOT NULL, care_level text NOT NULL,
  priority text NOT NULL, distance_miles double precision, estimated_duration_minutes text,
  base_price numeric(10,2) NOT NULL, distance_fee numeric(10,2) NOT NULL, care_fee numeric(10,2) NOT NULL,
  service_fee numeric(10,2) NOT NULL DEFAULT 0, tax numeric(10,2) NOT NULL, discount numeric(10,2) NOT NULL DEFAULT 0,
  total_price numeric(10,2) NOT NULL, payment_status payment_status NOT NULL DEFAULT 'test_paid',
  delivery_status delivery_status NOT NULL DEFAULT 'searching_driver', scheduled_at timestamptz, assigned_at timestamptz,
  picked_up_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS delivery_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  from_status delivery_status, to_status delivery_status NOT NULL, changed_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS driver_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE, latitude double precision NOT NULL,
  longitude double precision NOT NULL, accuracy_meters double precision, captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS delivery_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request jsonb NOT NULL, response jsonb NOT NULL, pricing_version text NOT NULL DEFAULT 'v1',
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL REFERENCES deliveries(id),
  customer_id uuid NOT NULL REFERENCES profiles(id), provider text NOT NULL, provider_payment_id text UNIQUE,
  provider_customer_id text, status text NOT NULL, amount numeric(10,2) NOT NULL, currency text NOT NULL DEFAULT 'usd',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, provider_event_id text NOT NULL,
  event_type text NOT NULL, payment_intent_id text NOT NULL, payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
);
CREATE TABLE IF NOT EXISTS ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES profiles(id), driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  score text NOT NULL CHECK (score IN ('1','2','3','4','5')), comment text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES profiles(id),
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL, category text NOT NULL, message text NOT NULL,
  status text NOT NULL DEFAULT 'open', assigned_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolution text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL, type text NOT NULL, title text NOT NULL, body text NOT NULL,
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, description text,
  discount_type text NOT NULL CHECK (discount_type IN ('fixed','percent')), discount_value numeric(10,2) NOT NULL,
  starts_at timestamptz, expires_at timestamptz, max_redemptions text, redemption_count text NOT NULL DEFAULT '0',
  active text NOT NULL DEFAULT 'true', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS driver_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE, gross_amount numeric(10,2) NOT NULL,
  adjustment_amount numeric(10,2) NOT NULL DEFAULT 0, net_amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending', paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deliveries_customer_created_idx ON deliveries(customer_id, created_at DESC);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS checkout_request_key text;
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_checkout_request_key_unique ON deliveries(checkout_request_key) WHERE checkout_request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS deliveries_driver_status_idx ON deliveries(driver_id, delivery_status);
CREATE INDEX IF NOT EXISTS delivery_status_history_delivery_created_idx ON delivery_status_history(delivery_id, created_at);
CREATE INDEX IF NOT EXISTS payment_webhook_events_payment_created_idx ON payment_webhook_events(payment_id, created_at);
CREATE INDEX IF NOT EXISTS payment_webhook_events_delivery_created_idx ON payment_webhook_events(delivery_id, created_at);
CREATE INDEX IF NOT EXISTS support_tickets_customer_created_idx ON support_tickets(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_locations_delivery_captured_idx ON driver_locations(delivery_id, captured_at DESC);