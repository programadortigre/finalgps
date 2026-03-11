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
    const maxRetries = 10;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            // Wait for PostgreSQL to be ready
            await pool.query('SELECT 1');
            
            // Check if column exists
            const checkColumn = await pool.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='locations' AND column_name='state';
            `);

            if (checkColumn.rowCount === 0) {
                logger.info('Migrating database: Adding "state" column to "locations" table...');
                try {
                    await pool.query(`
                        ALTER TABLE locations ADD COLUMN state VARCHAR(30) DEFAULT 'SIN_MOVIMIENTO';
                    `);
                    logger.info('✅ Migration completed successfully.');
                } catch (altErr) {
                    if (altErr.code === '42701') {
                        // Column already exists (duplicate column)
                        logger.info('✅ Column "state" already exists, skipping migration.');
                    } else {
                        throw altErr;
                    }
                }
            } else {
                logger.info('✅ Schema already up-to-date.');
            }
            return; // Success
        } catch (err) {
            retries++;
            const waitTime = Math.min(2000 * retries, 10000); // Max 10 seconds
            if (retries >= maxRetries) {
                logger.warn('⚠️  Could not sync schema after ' + maxRetries + ' retries. Continuing anyway...');
                logger.warn('Error: ' + err.message);
                return;
            }
            logger.warn('⏳ Schema sync attempt ' + retries + '/' + maxRetries + ' failed, retrying in ' + (waitTime / 1000) + 's...');
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    syncSchema,
    pool
};
