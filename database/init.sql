-- =============================================================================
-- GPS Tracking System — Schema Completo (v9)
-- Generado consolidando init + migrations v5→v9
-- Para instalar desde cero: este es el único archivo necesario.
-- Para DB existente: usar migration_v9_client_id.sql (el único pendiente).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rol y permisos
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'gpsuser') THEN
    CREATE ROLE gpsuser WITH LOGIN PASSWORD 'gpspass123';
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE tracking TO gpsuser;

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                VARCHAR(20)  DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
    is_tracking_enabled BOOLEAN      DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
    id               SERIAL PRIMARY KEY,
    employee_id      INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    start_time       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time         TIMESTAMP WITH TIME ZONE,
    distance_meters  FLOAT   DEFAULT 0,
    is_active        BOOLEAN DEFAULT TRUE,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- locations  (puntos GPS crudos + filtrados por EKF)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
    id           SERIAL PRIMARY KEY,
    trip_id      INTEGER REFERENCES trips(id)     ON DELETE CASCADE,
    employee_id  INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    geom         GEOGRAPHY(Point, 4326),
    latitude     FLOAT   NOT NULL,
    longitude    FLOAT   NOT NULL,
    speed        FLOAT,
    accuracy     FLOAT,
    state        VARCHAR(30)  DEFAULT 'SIN_MOVIMIENTO',
    is_matched   BOOLEAN      DEFAULT FALSE,
    timestamp    BIGINT  NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Telemetría extendida (v9)
    source       VARCHAR(20)  DEFAULT 'gps',
    quality      VARCHAR(10)  DEFAULT 'high',
    confidence   FLOAT        DEFAULT 1.0,
    point_type   VARCHAR(20)  DEFAULT 'normal',
    battery      INTEGER,
    is_charging  BOOLEAN      DEFAULT FALSE,
    reset_reason VARCHAR(50),

    -- Deduplicación end-to-end (v9)
    -- client_id: UUID generado por la APK por punto
    client_id    VARCHAR(64),

    -- Dedup primario por timestamp (legacy)
    UNIQUE(employee_id, timestamp)
);

-- Índice dedup por client_id (parcial — solo cuando no es NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_emp_client_id
    ON locations (employee_id, client_id)
    WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_locations_geom      ON locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_locations_emp_time  ON locations (employee_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_locations_trip_id   ON locations (trip_id);
CREATE INDEX IF NOT EXISTS idx_locations_is_matched ON locations (is_matched) WHERE is_matched = FALSE;

COMMENT ON COLUMN locations.client_id    IS 'UUID generado por APK por punto. Deduplicación end-to-end.';
COMMENT ON COLUMN locations.reset_reason IS 'Razón del reset GPS (gps_off, no_fix, app_restart, etc.).';

-- ---------------------------------------------------------------------------
-- matched_locations  (puntos snapeados a calles via OSRM)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matched_locations (
    id               SERIAL PRIMARY KEY,
    location_id      INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    trip_id          INTEGER REFERENCES trips(id)     ON DELETE CASCADE,
    geom             GEOGRAPHY(Point, 4326),
    latitude         FLOAT NOT NULL,
    longitude        FLOAT NOT NULL,
    speed            FLOAT,
    heading          FLOAT,
    match_confidence FLOAT,
    waypoint_index   INTEGER,
    road_name        TEXT,
    road_type        TEXT,
    is_interpolated  BOOLEAN DEFAULT FALSE,
    timestamp        BIGINT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matched_locations_trip_id     ON matched_locations (trip_id);
CREATE INDEX IF NOT EXISTS idx_matched_locations_location_id ON matched_locations (location_id);
CREATE INDEX IF NOT EXISTS idx_matched_locations_geom        ON matched_locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_matched_locations_time        ON matched_locations (timestamp ASC);

-- ---------------------------------------------------------------------------
-- stops  (paradas detectadas por DBSCAN)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stops (
    id               SERIAL PRIMARY KEY,
    trip_id          INTEGER REFERENCES trips(id)     ON DELETE CASCADE,
    employee_id      INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    geom             GEOGRAPHY(Point, 4326),
    latitude         FLOAT NOT NULL,
    longitude        FLOAT NOT NULL,
    start_time       TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time         TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    source           VARCHAR(10) DEFAULT 'auto',
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- trip_routes  (rutas pre-compiladas: raw + matched)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_routes (
    id                     SERIAL PRIMARY KEY,
    trip_id                INTEGER REFERENCES trips(id) ON DELETE CASCADE UNIQUE,
    geom_full              GEOGRAPHY(LineString, 4326),
    geom_simplified        GEOGRAPHY(LineString, 4326),  -- Douglas-Peucker
    geom_raw               GEOGRAPHY(LineString, 4326),  -- Kalman smoothed
    geom_matched           GEOGRAPHY(LineString, 4326),  -- OSRM matched
    point_count            INTEGER DEFAULT 0,
    point_count_simplified INTEGER DEFAULT 0,
    point_count_matched    INTEGER DEFAULT 0,
    match_confidence       FLOAT   DEFAULT 0,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trip_routes_trip_id ON trip_routes (trip_id);

-- ---------------------------------------------------------------------------
-- customers  (clientes / puntos de venta)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    address           TEXT,
    phone             TEXT,
    geom              GEOGRAPHY(Point, 4326) NOT NULL,
    geofence          GEOGRAPHY(Polygon, 4326),          -- Perímetro opcional (v8)
    min_visit_minutes INTEGER DEFAULT 5,                 -- Duración mínima visita válida (v8)
    metadata          JSONB   DEFAULT '{}',              -- Datos extra (v7)
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_geom     ON customers USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_customers_geofence ON customers USING GIST (geofence);
CREATE INDEX IF NOT EXISTS idx_customers_metadata ON customers USING GIN  (metadata);

COMMENT ON COLUMN customers.geofence          IS 'Perímetro opcional. Si NULL, usa radio alrededor de geom.';
COMMENT ON COLUMN customers.min_visit_minutes IS 'Duración mínima para contar como visita válida.';

-- ---------------------------------------------------------------------------
-- routes  (plantillas de ruta)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
    id                    SERIAL PRIMARY KEY,
    name                  VARCHAR(255) NOT NULL,
    optimized_json_cache  JSONB,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- route_customers  (clientes en una ruta, ordenados)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_customers (
    id          SERIAL PRIMARY KEY,
    route_id    INTEGER REFERENCES routes(id)    ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL,
    UNIQUE(route_id, customer_id)
);

-- ---------------------------------------------------------------------------
-- route_assignments  (asignación de ruta a vendedor por día)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_assignments (
    id           SERIAL PRIMARY KEY,
    route_id     INTEGER REFERENCES routes(id)    ON DELETE CASCADE,
    employee_id  INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    date         DATE    NOT NULL DEFAULT CURRENT_DATE,
    status       VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed')),
    started_at   TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, date)
);

-- ---------------------------------------------------------------------------
-- visits  (visitas detectadas automáticamente por geofence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visits (
    id               SERIAL PRIMARY KEY,
    customer_id      INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    employee_id      INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    date             DATE    NOT NULL DEFAULT CURRENT_DATE,
    arrived_at       TIMESTAMP WITH TIME ZONE NOT NULL,
    left_at          TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    status           VARCHAR(20) DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed', 'auto_closed')),
    auto_detected    BOOLEAN DEFAULT TRUE,
    visit_score      INTEGER CHECK (visit_score >= 0 AND visit_score <= 100),  -- Calidad visita (v8)
    visit_metadata   JSONB   DEFAULT '{}',                                     -- Detalles detector (v8)
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_visit_per_day UNIQUE(employee_id, customer_id, date)
);

CREATE INDEX IF NOT EXISTS idx_visits_employee_date ON visits (employee_id, date);
CREATE INDEX IF NOT EXISTS idx_visits_status        ON visits (status) WHERE status = 'ongoing';
CREATE INDEX IF NOT EXISTS idx_visits_metadata      ON visits USING GIN (visit_metadata);

COMMENT ON COLUMN visits.visit_score    IS 'Score de calidad de visita (0-100).';
COMMENT ON COLUMN visits.visit_metadata IS 'Detalles del detector (desplazamiento interno, puntos, etc.).';

-- ---------------------------------------------------------------------------
-- Permisos finales
-- ---------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO gpsuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gpsuser;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------
-- admin@tracking.com / admin123
INSERT INTO employees (name, email, password_hash, role)
VALUES ('System Admin', 'admin@tracking.com', '$2a$10$Nl4L5C3HUrGy9YqTjPAe7OKL8fRsp5Zi2yLTFAyPoRPYEK0pPTxae', 'admin')
ON CONFLICT (email) DO NOTHING;

-- john@tracking.com / vendor123
INSERT INTO employees (name, email, password_hash, role)
VALUES ('John Vendor', 'john@tracking.com', '$2a$10$CKkNznlPKBAqBlAoSWRf8u8Azx3RO9Dq3Y8L.Nubt743gH8CH99Pm', 'employee')
ON CONFLICT (email) DO NOTHING;
