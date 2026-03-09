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

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
