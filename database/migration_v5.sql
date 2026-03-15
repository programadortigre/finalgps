-- Migration V5: Map Matching Support

-- 1. Add 'is_matched' flag to raw locations to track processing
ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_matched BOOLEAN DEFAULT FALSE;

-- 2. Create matched_locations table for snapped/interpolated points
CREATE TABLE IF NOT EXISTS matched_locations (
    id SERIAL PRIMARY KEY,
    location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    geom GEOGRAPHY(Point, 4326),
    timestamp BIGINT,
    speed FLOAT,
    heading FLOAT,
    match_confidence FLOAT,
    waypoint_index INTEGER,
    road_name TEXT,
    road_type TEXT,
    is_interpolated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indices for performance
CREATE INDEX IF NOT EXISTS idx_matched_locations_trip_id ON matched_locations(trip_id);
CREATE INDEX IF NOT EXISTS idx_matched_locations_location_id ON matched_locations(location_id);
CREATE INDEX IF NOT EXISTS idx_matched_locations_geom ON matched_locations USING GIST (geom);

-- 4. Update trip_routes to include matched geometry column if not exists
ALTER TABLE trip_routes ADD COLUMN IF NOT EXISTS geom_matched GEOGRAPHY(LineString, 4326);
