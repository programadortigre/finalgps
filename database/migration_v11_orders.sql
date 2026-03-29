-- =============================================================================
-- Migration v11: Módulo de Pedidos y Catálogo Dinámico
-- Aplica sobre base existente (v10).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Añadir rol 'almacen' a empleados (si aún no existe el constraint)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    -- Eliminar el CHECK existente y crear uno nuevo que incluya 'almacen'
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'employees_role_check' AND conrelid = 'employees'::regclass
    ) THEN
        ALTER TABLE employees DROP CONSTRAINT employees_role_check;
    END IF;
END
$$;

ALTER TABLE employees 
    ADD CONSTRAINT employees_role_check 
    CHECK (role IN ('admin', 'employee', 'almacen'));

-- ---------------------------------------------------------------------------
-- 2. Añadir 'active' a clientes (si no existe)
-- ---------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- 3. system_settings — Configuraciones globales del sistema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT         NOT NULL,
    type        VARCHAR(20)  DEFAULT 'string' CHECK (type IN ('string','boolean','number','json')),
    description TEXT,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Valores por defecto
INSERT INTO system_settings (key, value, type, description) VALUES
    ('PEDIDOS_CALCULAR_IGV',         'true',  'boolean', 'Activar cálculo de IGV en pedidos'),
    ('PEDIDOS_PORCENTAJE_IGV',       '18',    'number',  'Porcentaje de IGV a aplicar'),
    ('CATALOGO_MOSTRAR_IMAGENES',    'true',  'boolean', 'Mostrar imágenes en la APK'),
    ('PEDIDOS_PERMITIR_DESCUENTOS',  'false', 'boolean', 'Permitir descuentos manuales por vendedor'),
    ('PEDIDOS_VER_HISTORIAL_CLIENTE','true',  'boolean', 'Vendedor puede ver pedidos previos del cliente'),
    ('GEOCERCA_RADIO_METROS',        '100',   'number',  'Radio en metros para autorelleno de cliente'),
    ('STOCK_MINIMO_ALERTA',          '5',     'number',  'Stock mínimo para alerta en la APK')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. products — Catálogo dinámico de productos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id                  SERIAL PRIMARY KEY,
    external_id         VARCHAR(100) UNIQUE,           -- ID del sistema externo (WooCommerce, ERP, etc.)
    titulo              VARCHAR(500) NOT NULL,
    descripcion         TEXT,
    descripcion_corta   VARCHAR(500),
    precio_con_igv      NUMERIC(12,2) NOT NULL DEFAULT 0,
    precio_sin_igv      NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock_general       INTEGER       NOT NULL DEFAULT 0,
    categoria           VARCHAR(200),
    tipo_producto       VARCHAR(100),
    tags                TEXT[],                         -- Array de tags para filtrado en APK
    imagen_url          TEXT,                           -- URL externa; nunca se guarda el archivo
    is_active           BOOLEAN       DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_updated        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP  -- Para delta sync en APK
);

CREATE INDEX IF NOT EXISTS idx_products_external_id  ON products (external_id);
CREATE INDEX IF NOT EXISTS idx_products_categoria    ON products (categoria);
CREATE INDEX IF NOT EXISTS idx_products_tipo         ON products (tipo_producto);
CREATE INDEX IF NOT EXISTS idx_products_last_updated ON products (last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_products_tags         ON products USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_products_active       ON products (is_active) WHERE is_active = TRUE;

COMMENT ON COLUMN products.external_id  IS 'ID del sistema externo; inmutable una vez creado.';
COMMENT ON COLUMN products.imagen_url   IS 'URL de imagen externa; nunca se almacena el binario.';
COMMENT ON COLUMN products.last_updated IS 'Timestamp para delta-sync en APK (?since=timestamp).';

-- Trigger para actualizar last_updated automáticamente
CREATE OR REPLACE FUNCTION update_product_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_update ON products;
CREATE TRIGGER trg_products_update
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_product_timestamp();

-- ---------------------------------------------------------------------------
-- 5. orders — Cabecera de pedidos (venta en ruta)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    client_id       VARCHAR(64) UNIQUE,                -- UUID generado por APK (deduplicación offline)
    employee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    customer_id     INTEGER REFERENCES customers(id)  ON DELETE SET NULL,
    trip_id         INTEGER REFERENCES trips(id)       ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                    CHECK (status IN ('pendiente','en_proceso','listo','entregado','cancelado')),
    subtotal        NUMERIC(12,2) DEFAULT 0,
    igv_monto       NUMERIC(12,2) DEFAULT 0,
    total           NUMERIC(12,2) DEFAULT 0,
    notas           TEXT,
    synced          BOOLEAN DEFAULT TRUE,              -- FALSE = pendiente de sync desde APK
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_employee_id  ON orders (employee_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id  ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_trip_id      ON orders (trip_id);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_id    ON orders (client_id) WHERE client_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. order_items — Detalle de productos por pedido
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    product_id  INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    quantity    INTEGER       NOT NULL CHECK (quantity > 0),
    precio_unit NUMERIC(12,2) NOT NULL,               -- Precio al momento del pedido (snapshot)
    subtotal    NUMERIC(12,2) GENERATED ALWAYS AS (quantity * precio_unit) STORED
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id   ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);

-- ---------------------------------------------------------------------------
-- 7. audit_logs — Registro de cambios críticos del sistema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id          SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,              -- 'product', 'order', 'setting', etc.
    entity_id   INTEGER,
    action      VARCHAR(50) NOT NULL,              -- 'price_change', 'stock_update', 'status_change'
    old_value   JSONB,
    new_value   JSONB,
    performed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ts     ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO gpsuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gpsuser;

-- ---------------------------------------------------------------------------
-- Mensaje de confirmación
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE 'Migration v11 applied successfully: products, orders, order_items, audit_logs, system_settings';
END
$$;
