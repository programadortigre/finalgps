-- Ejecutar en producción para crear trip_routes table
-- COMANDO: docker exec -i gps-postgres psql -U postgres -d tracking < setup_prod_trip_routes.sql

CREATE TABLE IF NOT EXISTS trip_routes (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER UNIQUE NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    geom_full GEOGRAPHY(LineString) NOT NULL,
    geom_simplified GEOGRAPHY(LineString) NOT NULL,
    point_count_full INTEGER,
    point_count_simplified INTEGER,
    tolerance_meters FLOAT DEFAULT 5,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Crear índices
CREATE INDEX IF NOT EXISTS idx_trip_routes_trip_id ON trip_routes(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_routes_created_at ON trip_routes(created_at);
CREATE INDEX IF NOT EXISTS idx_trip_routes_geom_full ON trip_routes USING GIST(geom_full);
CREATE INDEX IF NOT EXISTS idx_trip_routes_geom_simplified ON trip_routes USING GIST(geom_simplified);
CREATE INDEX IF NOT EXISTS idx_locations_created_brin ON locations USING BRIN(created_at);

-- Verificación
SELECT 'trip_routes table' as object, COUNT(*) as count FROM trip_routes
UNION ALL
SELECT 'indices created' as object, COUNT(*) as count FROM pg_indexes WHERE tablename='trip_routes';

SELECT '✅ Setup completado!' as status;
