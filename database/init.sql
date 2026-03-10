-- Create role if not exists (superuser will handle)
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
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
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, timestamp)
);

-- Spatial and standard indices
CREATE INDEX IF NOT EXISTS idx_locations_geom ON locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_locations_emp_time ON locations (employee_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_locations_trip_id ON locations (trip_id);

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

-- Data Seeding
-- admin@tracking.com / admin123
INSERT INTO employees (name, email, password_hash, role) 
VALUES ('System Admin', 'admin@tracking.com', '$2a$10$Nl4L5C3HUrGy9YqTjPAe7OKL8fRsp5Zi2yLTFAyPoRPYEK0pPTxae', 'admin')
ON CONFLICT (email) DO NOTHING;

-- john@tracking.com / vendor123
INSERT INTO employees (name, email, password_hash, role) 
VALUES ('John Vendor', 'john@tracking.com', '$2a$10$CKkNznlPKBAqBlAoSWRf8u8Azx3RO9Dq3Y8L.Nubt743gH8CH99Pm', 'employee')
ON CONFLICT (email) DO NOTHING;
