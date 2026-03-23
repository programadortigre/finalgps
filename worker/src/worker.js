const { Worker } = require('bullmq');
const Redis = require('ioredis');
const dotenv = require('dotenv');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

try {
    // If running in development, try to load .env from the project root
    dotenv.config({ path: '../../.env' });
    dotenv.config(); // Also try the current directory
} catch (e) {
    logger.info('.env file not found, using system environment variables');
}

const { processBatch, syncSchema, pool } = require('./tripProcessor');
const VisitDetector = require('./visitDetector');

// Sync database schema on startup
syncSchema().then(() => {
    logger.info('Database schema sync checked by worker.');
});

const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
});

// FEATURE FLAG: El detector solo se instancia si la variable está activa
const VISIT_DETECTION_ENABLED = process.env.VISIT_DETECTION_ENABLED === 'true';
const visitDetector = VISIT_DETECTION_ENABLED ? new VisitDetector(pool, connection) : null;

if (VISIT_DETECTION_ENABLED) {
    logger.info('FEATURE ENABLED: Visit Detection module is active.');
}

const worker = new Worker('location-updates', async (job) => {
    logger.info(`Processing job ${job.id} for employee ${job.data.employeeId}`);
    try {
        // Pasamos el detector (pode ser null si está desactivado)
        await processBatch(job.data.employeeId, job.data.points, visitDetector);
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
// Pool is now imported from tripProcessor

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

// --- NUEVO: Limpieza de Visitas Zombie (Cada 10 minutos) ---
cron.schedule('*/10 * * * *', async () => {
    if (!VISIT_DETECTION_ENABLED) return;
    
    logger.info('Running cron job: Zombie Visit Cleanup (> 2 hours)');
    try {
        const result = await pool.query(`
            UPDATE visits
            SET 
                left_at = NOW(),
                duration_seconds = EXTRACT(EPOCH FROM (NOW() - arrived_at)),
                status = 'auto_closed'
            WHERE 
                status = 'ongoing'
                AND arrived_at < NOW() - INTERVAL '2 hours';
        `);
        if (result.rowCount > 0) {
            logger.info(`[#METRICS#] ZOMBIE_VISITS_CLOSED: ${result.rowCount}`);
        }
    } catch (err) {
        logger.error('Error in zombie cleanup cron job:', err);
        await connection.incr('visit:metrics:errors');
    }
});
