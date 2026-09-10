-- Never allow pre-existing or provider-fallback coordinates to be presented as
-- verified navigation. New verified routes are explicitly marked by the API.
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS map_mode text NOT NULL DEFAULT 'demo';

ALTER TABLE deliveries
  DROP CONSTRAINT IF EXISTS deliveries_map_mode_check;

ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_map_mode_check CHECK (map_mode IN ('verified', 'demo'));