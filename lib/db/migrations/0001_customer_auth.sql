-- Customer credential and verification lifecycle.
-- Password values are derived server-side with scrypt and never stored in plaintext.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_email_active_idx
  ON profiles (email)
  WHERE status = 'active';