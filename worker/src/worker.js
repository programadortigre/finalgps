const { Worker } = require('bullmq');
const Redis = require('ioredis');
const dotenv = require('dotenv');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

try {
    dotenv.config({ path: '../.env' });
} catch (e) {
    logger.info('.env file not found, using system environment variables');
}

const { processBatch } = require('./tripProcessor');

const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
});

const worker = new Worker('location-updates', async (job) => {
    logger.info(`Processing job ${job.id} for employee ${job.data.employeeId}`);
    try {
        await processBatch(job.data.employeeId, job.data.points);
    } catch (err) {
        logger.error(`Error processing job ${job.id}:`, err);
        throw err;
    }
}, { connection });

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed with error:`, err);
});

logger.info('Worker started and waiting for jobs...');

// --- Data Retention: Retain only 6 months of data ---
const cron = require('node-cron');
const { Pool } = require('pg');
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'tracking',
});

// Run every day at 03:00 AM
cron.schedule('0 3 * * *', async () => {
    logger.info('Running cron job: Data Retention (delete > 6 months)');
    try {
        const result = await pool.query(`
            DELETE FROM locations WHERE created_at < NOW() - INTERVAL '6 months';
        `);
        logger.info(`Retention policy applied: ${result.rowCount} locations deleted.`);
    } catch (err) {
        logger.error('Error in retention cron job:', err);
    }
});
