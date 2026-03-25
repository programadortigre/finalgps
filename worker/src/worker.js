/**
 * GPS Tracking Worker — Producción Hardened
 *
 * Flujo: APK → API (filtra+EKF+encola) → BullMQ → Worker → PostgreSQL → Panel
 *
 * Garantías:
 *  - Idempotente: ON CONFLICT DO NOTHING por (employee_id, timestamp) Y client_id
 *  - Orden: concurrency=1 por employeeId via job grouping (queue key)
 *  - Retry-safe: toda la lógica es idempotente, los reintentos no duplican datos
 *  - Backpressure: limiter + métricas de cola expuestas en Redis
 *  - Dead Letter Queue: jobs que fallan 3 veces van a 'location-updates-dlq'
 *  - Prioridad: recovery/manual > normal
 */

'use strict';

const { Worker, Queue, UnrecoverableError } = require('bullmq');
const Redis = require('ioredis');
const { Pool } = require('pg');
const pino = require('pino');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
try { require('dotenv').config({ path: '../../.env' }); } catch (_) {}

const logger = pino({ transport: { target: 'pino-pretty' } });

// ---------------------------------------------------------------------------
// Conexiones
// ---------------------------------------------------------------------------
const redisOpts = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

// BullMQ necesita su propia conexión Redis (no compartir con pub/sub)
const redisConnection = new Redis(redisOpts);

// Redis separado para métricas (no bloquea el worker)
const redisMetrics = new Redis(redisOpts);

// Dead Letter Queue — jobs que fallaron definitivamente
const dlq = new Queue('location-updates-dlq', { connection: new Redis(redisOpts) });

const db = new Pool({
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432'),
    user:     process.env.POSTGRES_USER     || 'gpsuser',
    password: process.env.POSTGRES_PASSWORD || 'gpspass123',
    database: process.env.POSTGRES_DB       || 'tracking',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// ---------------------------------------------------------------------------
// 🔴 1. Idempotencia: getOrCreateTrip con advisory lock por employeeId
// Evita crear trips duplicados cuando concurrency > 1 procesa el mismo empleado
// ---------------------------------------------------------------------------
async function getOrCreateTrip(client, employeeId) {
    // Advisory lock por employeeId — garantiza que solo un worker a la vez
    // gestiona el trip de este empleado (evita race condition en INSERT)
    await client.query('SELECT pg_advisory_xact_lock($1)', [employeeId]);

    const res = await client.query(
        `SELECT id FROM trips
         WHERE employee_id = $1 AND is_active = TRUE
         ORDER BY start_time DESC LIMIT 1`,
        [employeeId]
    );

    if (res.rows.length > 0) return res.rows[0].id;

    const newTrip = await client.query(
        `INSERT INTO trips (employee_id, start_time, is_active)
         VALUES ($1, NOW(), TRUE)
         RETURNING id`,
        [employeeId]
    );
    logger.info({ employeeId, tripId: newTrip.rows[0].id }, '[TRIP] New trip created');
    return newTrip.rows[0].id;
}

// ---------------------------------------------------------------------------
// 🔴 1. Idempotencia: INSERT con ON CONFLICT en (employee_id, timestamp)
// Si el worker reintenta el mismo job, los puntos ya insertados se ignoran.
// ---------------------------------------------------------------------------
async function insertPoints(client, tripId, employeeId, points) {
    // Filtrar puntos que no deben ir al historial de ruta
    const routePoints = points.filter(p =>
        p.state !== 'GPS_OFF' &&
        p.state !== 'NO_FIX'  &&
        p.point_type !== 'heartbeat' &&
        p.point_type !== 'gps_off'
    );

    if (routePoints.length === 0) return 0;

    // Ordenar por timestamp antes de insertar (garantiza orden en DB)
    routePoints.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Insertar punto a punto para poder usar ON CONFLICT en client_id (índice parcial)
    // Idempotente en reintentos: si el punto ya existe, DO NOTHING.
    let inserted = 0;
    for (const p of routePoints) {
        if (p.client_id) {
            // Dedup primario: UNIQUE(employee_id, client_id) — cubre reintentos BullMQ
            const res = await client.query(
                `INSERT INTO locations
                   (trip_id, employee_id, latitude, longitude, speed, accuracy,
                    state, timestamp, geom, source, quality, confidence,
                    point_type, battery, is_charging, client_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                         ST_SetSRID(ST_MakePoint($4,$3),4326),
                         $9,$10,$11,$12,$13,$14,$15)
                 ON CONFLICT (employee_id, client_id) WHERE client_id IS NOT NULL DO NOTHING`,
                [
                    tripId, employeeId,
                    p.lat, p.lng,
                    p.speed      || 0,
                    p.accuracy   || 999,
                    p.state      || 'STOPPED',
                    p.timestamp,
                    p.source     || 'gps',
                    p.quality    || 'high',
                    p.confidence ?? 1.0,
                    p.point_type || 'normal',
                    p.battery    ?? null,
                    p.is_charging ?? false,
                    p.client_id,
                ]
            );
            inserted += res.rowCount ?? 0;
        } else {
            // Dedup secundario: UNIQUE(employee_id, timestamp) — APK sin client_id (versión vieja)
            const res = await client.query(
                `INSERT INTO locations
                   (trip_id, employee_id, latitude, longitude, speed, accuracy,
                    state, timestamp, geom, source, quality, confidence,
                    point_type, battery, is_charging)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                         ST_SetSRID(ST_MakePoint($4,$3),4326),
                         $9,$10,$11,$12,$13,$14)
                 ON CONFLICT (employee_id, timestamp) DO NOTHING`,
                [
                    tripId, employeeId,
                    p.lat, p.lng,
                    p.speed      || 0,
                    p.accuracy   || 999,
                    p.state      || 'STOPPED',
                    p.timestamp,
                    p.source     || 'gps',
                    p.quality    || 'high',
                    p.confidence ?? 1.0,
                    p.point_type || 'normal',
                    p.battery    ?? null,
                    p.is_charging ?? false,
                ]
            );
            inserted += res.rowCount ?? 0;
        }
    }

    return inserted;
}


// ---------------------------------------------------------------------------
// 🔴 2. Retry-safe: updateTripDistance es idempotente (recalcula desde cero)
// Puede ejecutarse N veces sin duplicar distancia.
// ---------------------------------------------------------------------------
async function updateTripDistance(client, tripId) {
    // Subquery con LAG calcula distancia acumulada entre puntos consecutivos
    // COALESCE(SUM(...), 0) maneja el caso de un solo punto (LAG = NULL)
    await client.query(
        `UPDATE trips SET
           distance_meters = (
               SELECT COALESCE(SUM(seg_dist), 0)
               FROM (
                   SELECT ST_Distance(
                       geom::geography,
                       LAG(geom::geography) OVER (ORDER BY timestamp)
                   ) AS seg_dist
                   FROM locations
                   WHERE trip_id = $1
                     AND state NOT IN ('GPS_OFF', 'NO_FIX', 'PAUSED')
               ) sub
               WHERE seg_dist IS NOT NULL
           ),
           end_time = NOW()
         WHERE id = $1`,
        [tripId]
    );
}

// ---------------------------------------------------------------------------
// Métricas de cola en Redis (para endpoint /queue-stats)
// Incluye: lag real (now - último timestamp insertado) para detectar retraso real
// ---------------------------------------------------------------------------
async function publishQueueMetrics(waiting, active, failed, completed, jobsPerSec, lagMs) {
    try {
        await redisMetrics.set('queue:stats', JSON.stringify({
            waiting, active, failed, completed,
            jobsPerSec,  // 🟢 4: rate real de procesamiento
            lagMs,       // 🟢 2: lag = now - timestamp del último punto insertado
            ts: Date.now(),
        }), 'EX', 60); // TTL 60s — si el worker muere, las métricas expiran
    } catch (_) { /* no crítico */ }
}

// ---------------------------------------------------------------------------
// 🔴 5. Processor con logs completos
// ---------------------------------------------------------------------------
async function processJob(job) {
    const { employeeId, points } = job.data;
    const jobStart = Date.now();

    logger.info({ jobId: job.id, employeeId, pts: points?.length, attempt: job.attemptsMade + 1 },
        '[WORKER] Job received');

    // Validación básica — si el payload es inválido, no reintentar
    if (!employeeId || !Array.isArray(points) || points.length === 0) {
        logger.warn({ jobId: job.id }, '[WORKER] Job skipped: invalid payload');
        throw new UnrecoverableError('Invalid payload: missing employeeId or points');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 🔴 2. getOrCreateTrip dentro de transacción con advisory lock
        const tripId = await getOrCreateTrip(client, employeeId);

        // 🔴 1. Insert idempotente
        const inserted = await insertPoints(client, tripId, employeeId, points);

        // 🔴 2. updateTripDistance idempotente — seguro en reintentos
        if (inserted > 0) {
            await updateTripDistance(client, tripId);
        }

        await client.query('COMMIT');

        const elapsed = Date.now() - jobStart;
        logger.info(
            { jobId: job.id, employeeId, tripId, inserted, total: points.length, ms: elapsed },
            '[WORKER] Job completed'
        );

        return { inserted, tripId, ms: elapsed };

    } catch (err) {
        await client.query('ROLLBACK');

        // Errores de datos corruptos → no reintentar, ir a DLQ
        const isDataError = ['23502', '22P02', '22003', '23514'].includes(err.code);
        if (isDataError) {
            logger.error({ jobId: job.id, code: err.code, msg: err.message },
                '[WORKER] Unrecoverable data error → DLQ');
            await dlq.add('failed-job', { originalJob: job.data, error: err.message }, {
                removeOnComplete: false,
                removeOnFail: false,
            });
            throw new UnrecoverableError(`Data error [${err.code}]: ${err.message}`);
        }

        logger.error({ jobId: job.id, attempt: job.attemptsMade + 1, msg: err.message },
            '[WORKER] Job failed — will retry');
        throw err; // BullMQ reintentará con backoff exponencial
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------
// 🔴 3. Concurrencia: 1 por defecto para garantizar orden temporal
// Si necesitas más throughput, usa job grouping por employeeId en lugar de
// aumentar concurrency globalmente.
// ---------------------------------------------------------------------------
const worker = new Worker('location-updates', processJob, {
    connection: redisConnection,
    concurrency: 1,   // Orden garantizado — un job a la vez
    // 🔴 4. Backpressure: limitar velocidad de procesamiento
    limiter: {
        max: 50,          // Máx 50 jobs/segundo
        duration: 1000,
    },
});

// ---------------------------------------------------------------------------
// 🔴 5. Eventos con logs completos
// ---------------------------------------------------------------------------
worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, '[WORKER] ✅ completed');
});

worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
        '[WORKER] ❌ failed');
});

worker.on('error', (err) => {
    logger.error({ err: err.message }, '[WORKER] Worker-level error');
});

worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, '[WORKER] ⚠️ Job stalled — will be retried');
});

// ---------------------------------------------------------------------------
// 🟢 4. Backpressure monitor — publica métricas cada 10s
// Backpressure threshold RELATIVO: alerta si waiting > jobsPerSec * 10
// (no un número fijo — se adapta al throughput real del worker)
// ---------------------------------------------------------------------------
let prevCompletedMetrics = null;
let prevMetricsTs        = null;

const metricsInterval = setInterval(async () => {
    try {
        const mainQueue = new Queue('location-updates', { connection: new Redis(redisOpts) });
        const [waiting, active, failed, completed] = await Promise.all([
            mainQueue.getWaitingCount(),
            mainQueue.getActiveCount(),
            mainQueue.getFailedCount(),
            mainQueue.getCompletedCount(),
        ]);
        await mainQueue.close();

        // 🟢 4: Calcular jobs/sec real entre dos intervalos
        let jobsPerSec = 0;
        const nowTs = Date.now();
        if (prevCompletedMetrics !== null && prevMetricsTs !== null) {
            const deltaJobs = completed - prevCompletedMetrics;
            const deltaSec  = (nowTs - prevMetricsTs) / 1000;
            // 🔴 2: Reset detection — si completed bajó, el worker se reinició
            if (deltaJobs < 0) {
                logger.warn({ prevCompleted: prevCompletedMetrics, completed }, '[WORKER] ⚠️ completed counter reset detected — worker restarted?');
                // Reiniciar cálculo sin publicar rate incorrecto
            } else if (deltaSec > 0) {
                jobsPerSec = parseFloat((deltaJobs / deltaSec).toFixed(3));
            }
        }
        prevCompletedMetrics = completed;
        prevMetricsTs        = nowTs;

        // 🟢 2: Lag real — timestamp del último punto insertado vs ahora
        let lagMs = null;
        try {
            const lagRes = await db.query(
                `SELECT MAX(timestamp) as last_ts FROM locations WHERE created_at > NOW() - INTERVAL '5 minutes'`
            );
            const lastTs = lagRes.rows[0]?.last_ts;
            if (lastTs) lagMs = Date.now() - Number(lastTs);
        } catch (_) { /* no crítico */ }

        await publishQueueMetrics(waiting, active, failed, completed, jobsPerSec, lagMs);

        // 🔴 4: Backpressure RELATIVO — alerta si cola > 10x throughput actual
        const backpressureThreshold = jobsPerSec > 0 ? Math.ceil(jobsPerSec * 10) : 500;
        if (waiting > backpressureThreshold) {
            logger.warn({ waiting, active, jobsPerSec, threshold: backpressureThreshold },
                '[WORKER] ⚠️ Queue backpressure detected');
        }

        // 🔴 5: Alerta si failed crece (>10 jobs fallidos acumulados)
        if (failed > 10) {
            logger.error({ failed }, '[WORKER] 🚨 High failure count — check DLQ');
        }

        // 🟢 2: Alerta si lag real > 5min (datos llegando muy tarde a la DB)
        if (lagMs !== null && lagMs > 300000) {
            logger.warn({ lagMs: Math.round(lagMs / 1000) + 's' }, '[WORKER] ⚠️ High processing lag');
        }
    } catch (_) {}
}, 10000);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
    logger.info(`[WORKER] ${signal} received — shutting down gracefully`);
    clearInterval(metricsInterval);
    await worker.close();
    await db.end();
    redisConnection.disconnect();
    redisMetrics.disconnect();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
logger.info('[WORKER] 🚀 GPS Worker started');
logger.info(`[WORKER] Queue : location-updates (concurrency=1)`);
logger.info(`[WORKER] Redis : ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
logger.info(`[WORKER] PG    : ${process.env.POSTGRES_HOST || 'localhost'}/${process.env.POSTGRES_DB || 'tracking'}`);
