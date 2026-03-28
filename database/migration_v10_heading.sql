-- MIGRACION V10: Rumbo (Heading/Bearing) para Alta Fidelidad de Rutas
-- Agrega soporte para dirección de movimiento en la tabla de ubicaciones.

-- 1. Agregar columna heading (rumbo en grados 0-360)
ALTER TABLE locations ADD COLUMN IF NOT EXISTS heading REAL DEFAULT 0.0;

-- 2. Actualizar el índice de búsqueda si fuera necesario (opcional, heading no suele filtrarse)
-- No se requiere índice para heading ya que se usa solo para visualización.

-- 3. Comentario de auditoría
COMMENT ON COLUMN locations.heading IS 'Rumbo o dirección de movimiento en grados (0-360). Proporcionado por el sensor de GPS para mejorar la fidelidad de la ruta.';

-- 4. Verificar
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='locations' AND column_name='heading') THEN
        RAISE NOTICE 'Columna "heading" agregada correctamente a la tabla locations.';
    END IF;
END $$;
