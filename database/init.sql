-- Create role if not exists (superuser will handle)
-- Create gpsuser role with password if doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'gpsuser') THEN
    CREATE ROLE gpsuser WITH LOGIN PASSWORD 'gpspass123';
  END IF;
END
$$;

-- Grant permissions to gpsuser
GRANT ALL PRIVILEGES ON DATABASE tracking TO gpsuser;

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
    is_tracking_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trips table
CREATE TABLE IF NOT EXISTS trips (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE,
    distance_meters FLOAT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Locations (Raw GPS Points)
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    geom GEOGRAPHY(Point, 4326),
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed FLOAT,
    accuracy FLOAT,
    state VARCHAR(30) DEFAULT 'SIN_MOVIMIENTO',
    is_matched BOOLEAN DEFAULT FALSE,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, timestamp)
);

-- Spatial and standard indices
CREATE INDEX IF NOT EXISTS idx_locations_geom ON locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_locations_emp_time ON locations (employee_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_locations_trip_id ON locations (trip_id);
CREATE INDEX IF NOT EXISTS idx_locations_is_matched ON locations (is_matched) WHERE is_matched = FALSE;

-- Matched Locations (Cleaned/Smoothed Road Points)
CREATE TABLE IF NOT EXISTS matched_locations (
    id SERIAL PRIMARY KEY,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    geom GEOGRAPHY(Point, 4326),
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed FLOAT,
    match_confidence FLOAT,
    waypoint_index INTEGER,
    road_name VARCHAR(255),
    is_interpolated BOOLEAN DEFAULT FALSE,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matched_locations_trip_id ON matched_locations (trip_id);
CREATE INDEX IF NOT EXISTS idx_matched_locations_time ON matched_locations (timestamp ASC);

-- Stops table
CREATE TABLE IF NOT EXISTS stops (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    geom GEOGRAPHY(Point, 4326),
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Simplified Routes table (for performance optimization)
CREATE TABLE IF NOT EXISTS trip_routes (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
    geom_full GEOGRAPHY(LineString, 4326),
    geom_simplified GEOGRAPHY(LineString, 4326),
    geom_matched GEOGRAPHY(LineString, 4326),
    point_count INTEGER DEFAULT 0,
    point_count_simplified INTEGER DEFAULT 0,
    simplification_tolerance FLOAT DEFAULT 0.0001,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for trip_routes
CREATE INDEX IF NOT EXISTS idx_trip_routes_trip_id ON trip_routes (trip_id);

-- Grant table permissions to gpsuser
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO gpsuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gpsuser;

-- Data Seeding
-- admin@tracking.com / admin123
INSERT INTO employees (name, email, password_hash, role) 
VALUES ('System Admin', 'admin@tracking.com', '$2a$10$Nl4L5C3HUrGy9YqTjPAe7OKL8fRsp5Zi2yLTFAyPoRPYEK0pPTxae', 'admin')
ON CONFLICT (email) DO NOTHING;

-- john@tracking.com / vendor123
INSERT INTO employees (name, email, password_hash, role) 
VALUES ('John Vendor', 'john@tracking.com', '$2a$10$CKkNznlPKBAqBlAoSWRf8u8Azx3RO9Dq3Y8L.Nubt743gH8CH99Pm', 'employee')
ON CONFLICT (email) DO NOTHING;
