const { Pool } = require('pg');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'tracking',
    port: process.env.POSTGRES_PORT || 5432,
});

pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', err);
});

async function syncSchema() {
    const maxRetries = 15;
    let retries = 0;

    logger.info('🚀 Starting database schema synchronization...');

    while (retries < maxRetries) {
        try {
            // Wait for PostgreSQL to be ready
            await pool.query('SELECT 1');
            
            // 1. Enable PostGIS
            await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');

            // 2. Create Customers Table (if missing)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS customers (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    address TEXT,
                    phone TEXT,
                    metadata JSONB DEFAULT '{}',
                    geom GEOGRAPHY(Point, 4326) NOT NULL,
                    geofence GEOGRAPHY(Polygon, 4326),
                    min_visit_minutes INTEGER DEFAULT 5,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await pool.query('CREATE INDEX IF NOT EXISTS idx_customers_geom ON customers USING GIST (geom);');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_customers_metadata ON customers USING GIN (metadata);');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_customers_geofence ON customers USING GIST (geofence);');

            // 3. Create Visits Table (if missing)
            await pool.query(`
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
                    visit_score INTEGER CHECK (visit_score >= 0 AND visit_score <= 100),
                    visit_metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT unique_visit_per_day UNIQUE(employee_id, customer_id, date)
                );
            `);
            await pool.query('CREATE INDEX IF NOT EXISTS idx_visits_employee_date ON visits (employee_id, date);');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_visits_metadata ON visits USING GIN (visit_metadata);');

            // 4. Ensure existing tables have new columns (Migrations)
            
            // Performance Indices (v10)
            await pool.query('CREATE INDEX IF NOT EXISTS idx_trips_employee_date ON trips (employee_id, start_time DESC);');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_trip_routes_trip_id ON trip_routes (trip_id);');

            // Employees: pending_command
            const checkCmdColumn = await pool.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='employees' AND column_name='pending_command';
            `);
            if (checkCmdColumn.rowCount === 0) {
                // Check if table exists first (for robustness)
                const checkTableEmp = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='employees';`);
                if (checkTableEmp.rowCount > 0) {
                    await pool.query('ALTER TABLE employees ADD COLUMN pending_command VARCHAR(50);');
                }
            }

            // Locations: state
            const checkLocState = await pool.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='locations' AND column_name='state';
            `);
            if (checkLocState.rowCount === 0) {
                const checkTableLoc = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='locations';`);
                if (checkTableLoc.rowCount > 0) {
                    await pool.query('ALTER TABLE locations ADD COLUMN state VARCHAR(30) DEFAULT \'SIN_MOVIMIENTO\';');
                }
            }

            // Customers: phone/metadata (redundant due to CREATE above but good for safety)
            const checkCustColumns = await pool.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name='customers' AND column_name IN ('phone', 'metadata');
            `);
            if (checkCustColumns.rowCount < 2) {
                const existing = checkCustColumns.rows.map(r => r.column_name);
                if (!existing.includes('phone')) await pool.query('ALTER TABLE customers ADD COLUMN phone TEXT;');
                if (!existing.includes('metadata')) await pool.query('ALTER TABLE customers ADD COLUMN metadata JSONB DEFAULT \'{}\';');
            }

            // Customers: geofence and min_visit_minutes (v8 migration)
            const checkGeofence = await pool.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='customers' AND column_name='geofence';
            `);
            if (checkGeofence.rowCount === 0) {
                await pool.query('ALTER TABLE customers ADD COLUMN geofence GEOGRAPHY(Polygon, 4326);');
                await pool.query('CREATE INDEX IF NOT EXISTS idx_customers_geofence ON customers USING GIST (geofence);');
            }

            const checkMinVisit = await pool.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='customers' AND column_name='min_visit_minutes';
            `);
            if (checkMinVisit.rowCount === 0) {
                await pool.query('ALTER TABLE customers ADD COLUMN min_visit_minutes INTEGER DEFAULT 5;');
            }

            // Visits: visit_score and visit_metadata (v8 migration)
            const checkVisitScore = await pool.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='visits' AND column_name='visit_score';
            `);
            if (checkVisitScore.rowCount === 0) {
                await pool.query('ALTER TABLE visits ADD COLUMN visit_score INTEGER CHECK (visit_score >= 0 AND visit_score <= 100);');
            }

            const checkVisitMeta = await pool.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='visits' AND column_name='visit_metadata';
            `);
            if (checkVisitMeta.rowCount === 0) {
                await pool.query('ALTER TABLE visits ADD COLUMN visit_metadata JSONB DEFAULT \'{}\';');
                await pool.query('CREATE INDEX IF NOT EXISTS idx_visits_metadata ON visits USING GIN (visit_metadata);');
            }

            logger.info('✅ Database schema synchronized successfully.');
            return;
        } catch (err) {
            retries++;
            const waitTime = Math.min(1000 * retries, 5000);
            if (retries >= maxRetries) {
                logger.error('❌ Failed to sync schema: ' + err.message);
                return;
            }
            logger.warn(`⏳ Schema sync attempt ${retries}/${maxRetries} failed (${err.message}). Retrying in ${waitTime/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    syncSchema,
    pool
};
