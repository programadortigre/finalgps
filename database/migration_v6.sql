-- Migration V6: Customers, Routes and Visits
-- HARDENING EDITION - NO MODIFICA TABLAS EXISTENTES

-- 1. Clientes
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    geom GEOGRAPHY(Point, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customers_geom ON customers USING GIST (geom);

-- 2. Rutas (Plantillas)
CREATE TABLE IF NOT EXISTS routes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    optimized_json_cache JSONB, -- Cache para OSRM
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Clientes en Ruta (Ordenación)
CREATE TABLE IF NOT EXISTS route_customers (
    id SERIAL PRIMARY KEY,
    route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    UNIQUE(route_id, customer_id)
);

-- 4. Asignaciones de Ruta a Vendedores
CREATE TABLE IF NOT EXISTS route_assignments (
    id SERIAL PRIMARY KEY,
    route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed')),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, date) -- Regla: Una ruta por vendedor por día
);

-- 5. Visitas (Hardened Cycle)
CREATE TABLE IF NOT EXISTS visits (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    arrived_at TIMESTAMP WITH TIME ZONE NOT NULL,
    left_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    status VARCHAR(20) DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed', 'auto_closed')),
    auto_detected BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_visit_per_day UNIQUE(employee_id, customer_id, date)
);

CREATE INDEX IF NOT EXISTS idx_visits_employee_date ON visits (employee_id, date);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits (status) WHERE status = 'ongoing';

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO gpsuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gpsuser;
