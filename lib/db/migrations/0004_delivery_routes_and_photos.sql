-- Route coordinates are already stored on deliveries. Package-photo object bytes
-- remain in private App Storage; this table retains only queryable safe metadata.
CREATE TABLE IF NOT EXISTS delivery_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  uploaded_by_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes numeric(12,0) NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_photos_delivery_created_idx ON delivery_photos(delivery_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_photos_uploaded_by_idx ON delivery_photos(uploaded_by_profile_id);

CREATE TABLE IF NOT EXISTS delivery_photo_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  uploader_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes numeric(12,0) NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_photo_uploads_expiry_idx ON delivery_photo_uploads(expires_at);
CREATE INDEX IF NOT EXISTS delivery_photo_uploads_owner_idx ON delivery_photo_uploads(delivery_id, uploader_profile_id, expires_at);