#!/bin/bash
# Script para ejecutar en el servidor de producción
# Esto crea la tabla trip_routes si no existe

echo "🔧 Creando tabla trip_routes en producción..."

docker exec -i gps-postgres psql -U postgres -d tracking << 'EOF'
-- Crear tabla trip_routes si no existe
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

-- Verificar
SELECT COUNT(*) as trip_routes_count FROM trip_routes;
SELECT COUNT(*) as indices_count FROM pg_indexes WHERE tablename='trip_routes';

SELECT 'Setup completado! ✅' as status;
EOF

echo "✅ Tabla trip_routes creada/verificada"
