const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
});

const locationQueue = new Queue('location-updates', { connection });

// Opciones por defecto para todos los jobs de ubicación
const defaultJobOptions = {
    attempts: 3,                    // Reintentar hasta 3 veces si el worker falla
    backoff: {
        type: 'exponential',
        delay: 2000,                // 2s, 4s, 8s
    },
    removeOnComplete: { count: 100 }, // Mantener solo los últimos 100 jobs completados
    removeOnFail:     { count: 500 }, // Mantener últimos 500 fallidos para debug
};

module.exports = { locationQueue, redis: connection, defaultJobOptions };
