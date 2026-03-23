/**
 * SCRIPT DE SIMULACIÓN DE CARGA (gps-tracking-v3)
 * Uso: node simulate_load.js [num_employees] [points_per_batch]
 */

const { Queue } = require('bullmq');
const Redis = require('ioredis');

// Configuración de conexión (Ajustar si es necesario)
const redisConnection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
});

const locationQueue = new Queue('location-updates', { connection: redisConnection });

const numEmployees = parseInt(process.argv[2]) || 100;
const pointsPerBatch = parseInt(process.argv[3]) || 5;

async function runSimulation() {
    console.log(`🚀 Iniciando simulación para ${numEmployees} empleados virtuales...`);
    console.log(`📦 Cada batch contiene ${pointsPerBatch} puntos.`);

    const start = Date.now();
    const baseLat = -12.0464;
    const baseLng = -77.0428;

    for (let i = 1; i <= numEmployees; i++) {
        const employeeId = 1000 + i; // IDs virtuales
        
        // Generar puntos aleatorios cerca del centro
        const points = [];
        for (let j = 0; j < pointsPerBatch; j++) {
            points.push({
                lat: baseLat + (Math.random() - 0.5) * 0.01,
                lng: baseLng + (Math.random() - 0.5) * 0.01,
                accuracy: Math.random() * 30 + 5,
                speed: Math.random() * 40,
                timestamp: Date.now() - (j * 5000),
                state: Math.random() > 0.8 ? 'DRIVING' : 'WALKING'
            });
        }

        // Enviar al queue
        await locationQueue.add('process-batch', {
            employeeId,
            points
        });

        if (i % 50 === 0) console.log(`✅ Inyectados ${i} batches...`);
    }

    const duration = (Date.now() - start) / 1000;
    console.log(`\n✨ Simulación completada en ${duration}s`);
    console.log(`⚠️  Ahora monitorea los logs del worker para ver el tiempo de procesamiento real.`);
    console.log(`👉 docker logs -f gps-worker`);
    
    process.exit(0);
}

runSimulation().catch(err => {
    console.error('❌ Error en simulación:', err);
    process.exit(1);
});
