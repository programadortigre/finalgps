const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
});

const locationQueue = new Queue('location-updates', { connection });

module.exports = { locationQueue, redis: connection };
