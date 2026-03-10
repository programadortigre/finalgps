-- ============================================================================
-- PASO 1: CREAR TABLA trip_routes + ÍNDICES PARA SIMPLIFICACIÓN DE RUTAS
-- ============================================================================
-- Ejecutar en: PostgreSQL con PostGIS habilitado
-- Fecha: 2026-03-10
-- Duración: ~1 minuto
-- Riesgo: BAJO (solo CREATE, sin modificación de datos existentes)

-- ============================================================================
-- 1. CREAR TABLA trip_routes
-- ============================================================================
-- Almacenará rutas compiladas y simplificadas para cada viaje
-- Las rutas se generan automáticamente cuando el viaje termina

CREATE TABLE IF NOT EXISTS trip_routes (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
    
    -- Rutas en dos versiones:
    geom_full GEOGRAPHY(LineString, 4326) NOT NULL,          -- Todos los puntos
    geom_simplified GEOGRAPHY(LineString, 4326) NOT NULL,    -- Puntos simplificados
    
    -- Estadísticas
    point_count_full INTEGER,                -- Puntos originales (1920)
    point_count_simplified INTEGER,          -- Puntos después de simplificación (120)
    tolerance_meters FLOAT DEFAULT 5,        -- Tolerancia de simplificación
    
    -- Auditoría
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. CREAR ÍNDICES PARA BÚSQUEDAS RÁPIDAS
-- ============================================================================

-- Índice por trip_id (búsqueda rápida de ruta por viaje)
CREATE INDEX IF NOT EXISTS idx_trip_routes_trip_id 
ON trip_routes(trip_id);

-- Índice por timestamp de creación (para estadísticas)
CREATE INDEX IF NOT EXISTS idx_trip_routes_created_at 
ON trip_routes(created_at DESC);

-- Índice GIST para búsquedas geoespaciales (opcional, para futuro)
CREATE INDEX IF NOT EXISTS idx_trip_routes_geom_full 
ON trip_routes USING GIST (geom_full);

CREATE INDEX IF NOT EXISTS idx_trip_routes_geom_simplified 
ON trip_routes USING GIST (geom_simplified);

-- ============================================================================
-- 3. VERIFICAR CREACIÓN (ESTE COMANDO RETORNA 0)
-- ============================================================================
-- SELECT COUNT(*) FROM trip_routes;
-- -- Resultado esperado: 0 (tabla vacía, aún sin rutas compiladas)

-- ============================================================================
-- 4. AGREGAR ÍNDICE BRIN EN locations (MEJORA PERFORMANCE PARA DELETE CRON)
-- ============================================================================
-- Este índice hace más rápido el cron que elimina puntos con >6 meses

CREATE INDEX IF NOT EXISTS idx_locations_created_brin 
ON locations USING BRIN (created_at);

-- ============================================================================
-- 5. ESTADÍSTICAS FINALES
-- ============================================================================
-- Después de ejecutar este SQL:
-- ✅ Tabla trip_routes creada (vacía)
-- ✅ Índices creados para búsquedas rápidas
-- ✅ Relación 1:1 entre trips y trip_routes (UNIQUE trip_id)
-- ✅ Ready para que Worker inserte rutas compiladas
-- ✅ Storage estimado: +0 MB (tabla vacía)
-- ✅ Performance: No hay impacto en inserts existentes

-- VERIFICAR QUE TODO ESTÁ BIEN:
-- SELECT tablename FROM pg_tables WHERE tablename = 'trip_routes';
-- -- Debe retornar: trip_routes

-- SELECT COUNT(*) FROM information_schema.tables 
-- WHERE table_name = 'trip_routes';
-- -- Debe retornar: 1
