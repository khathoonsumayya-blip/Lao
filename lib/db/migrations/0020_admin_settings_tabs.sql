CREATE TABLE IF NOT EXISTS security_settings (
  id text PRIMARY KEY DEFAULT 'security', session_timeout_minutes text NOT NULL DEFAULT '60',
  suspicious_login_alerts text NOT NULL DEFAULT 'true', updated_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_fee_settings (
  id text PRIMARY KEY DEFAULT 'payments', currency text NOT NULL DEFAULT 'USD',
  customer_service_fee_cents text NOT NULL DEFAULT '0', delivery_fee_cents text NOT NULL DEFAULT '0',
  small_order_threshold_cents text NOT NULL DEFAULT '0', small_order_fee_cents text NOT NULL DEFAULT '0',
  tax_rate_basis_points text NOT NULL DEFAULT '0', refund_window_days text NOT NULL DEFAULT '30',
  updated_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_settings (
  id text PRIMARY KEY DEFAULT 'email', sender_display_name text NOT NULL DEFAULT 'Anything Anywhere',
  reply_to_email text, support_email text, welcome_enabled text NOT NULL DEFAULT 'true',
  password_reset_enabled text NOT NULL DEFAULT 'true', order_confirmation_enabled text NOT NULL DEFAULT 'true',
  order_delivered_enabled text NOT NULL DEFAULT 'true', updated_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_action_created_idx ON admin_audit_logs(action, created_at DESC);