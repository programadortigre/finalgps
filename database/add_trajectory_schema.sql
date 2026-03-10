-- Add Trajectory Analysis Schema
-- This script adds the necessary tables and columns for advanced GPS tracking analysis.

-- 1. Create clients table
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    geom GEOGRAPHY(Point, 4326),
    expected_visit_time INTEGER DEFAULT 5, -- in minutes
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add spatial index for clients
CREATE INDEX IF NOT EXISTS idx_clients_geom ON clients USING GIST (geom);

-- 2. Create visits table
CREATE TABLE IF NOT EXISTS visits (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    duration INTEGER, -- in seconds
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Create state_events table
CREATE TABLE IF NOT EXISTS state_events (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    duration INTEGER, -- in seconds
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Modify locations table
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='locations' AND COLUMN_NAME='state') THEN
        ALTER TABLE locations ADD COLUMN state TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='locations' AND COLUMN_NAME='metadata') THEN
        ALTER TABLE locations ADD COLUMN metadata JSONB;
    END IF;
END $$;

-- 5. Create indices for locations
CREATE INDEX IF NOT EXISTS idx_locations_geom ON locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_locations_employee_time ON locations(employee_id, timestamp DESC);
