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
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
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
            return; // Success
        } catch (err) {
            retries++;
            if (retries >= maxRetries) {
                logger.warn('Could not sync schema after ' + maxRetries + ' retries. Continuing anyway...', err.message);
                return;
            }
            logger.warn('Schema sync attempt ' + retries + ' failed, retrying in 2s...', err.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    syncSchema,
    pool
};
