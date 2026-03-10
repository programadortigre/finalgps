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
    try {
        const checkColumn = await pool.query(`
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='locations' AND column_name='state';
        `);

        if (checkColumn.rowCount === 0) {
            logger.info('Migrating database: Adding "state" column to "locations" table...');
            await pool.query(`
                ALTER TABLE locations ADD COLUMN state VARCHAR(30) DEFAULT 'SIN_MOVIMIENTO';
            `);
            logger.info('Migration completed successfully.');
        }
    } catch (err) {
        logger.error('Error during schema synchronization:', err);
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    syncSchema,
    pool
};
