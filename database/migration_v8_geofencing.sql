-- Migration V8: Geofencing and Smart Visits
-- Adds support for polygons/perimeters and quality-of-visit metrics.

-- 1. Update Customers Table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS geofence GEOGRAPHY(Polygon, 4326);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS min_visit_minutes INTEGER DEFAULT 5;

-- Spatial Index for Geofence
CREATE INDEX IF NOT EXISTS idx_customers_geofence ON customers USING GIST (geofence);

-- 2. Update Visits Table
ALTER TABLE visits ADD COLUMN IF NOT EXISTS visit_score INTEGER CHECK (visit_score >= 0 AND visit_score <= 100);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS visit_metadata JSONB DEFAULT '{}';

-- Index for metadata searches
CREATE INDEX IF NOT EXISTS idx_visits_metadata ON visits USING GIN (visit_metadata);

-- 3. Comments for documentation
COMMENT ON COLUMN customers.geofence IS 'Optional perimeter/polygon for the store. If NULL, falls back to radius around geom point.';
COMMENT ON COLUMN customers.min_visit_minutes IS 'Minimum duration required to count as a valid visit.';
COMMENT ON COLUMN visits.visit_score IS 'Quality score of the visit (0-100) based on duration and movement.';
COMMENT ON COLUMN visits.visit_metadata IS 'Additional details from the detector (internal displacement, points, etc.)';

-- Grant permissions (just in case)
GRANT ALL PRIVILEGES ON TABLE customers TO gpsuser;
GRANT ALL PRIVILEGES ON TABLE visits TO gpsuser;
