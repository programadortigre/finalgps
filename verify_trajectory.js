const { Pool } = require('pg');
const { processBatch } = require('./src/tripProcessor');

const pool = new Pool({
    host: 'postgres',
    user: 'postgres',
    password: 'postgres',
    database: 'tracking',
});

async function runVerification() {
    console.log('--- Starting Trajectory Verification ---');
    const employeeId = 1;

    try {
        // 1. Seed a Client
        await pool.query('DELETE FROM visits');
        await pool.query('DELETE FROM state_events');
        await pool.query('DELETE FROM locations'); // Clear locations too
        await pool.query('DELETE FROM clients');
        await pool.query("INSERT INTO clients (name, address, geom) VALUES ('Bodega Perez', 'Calle 123', ST_SetSRID(ST_MakePoint(-77.0428, -12.0464), 4326)::geography)");
        console.log('✔ Client seeded');

        // 2. Create Mock Trajectory
        const startTime = Date.now() - 3600000;
        const points = [];

        // Driving (Vehicle)
        for (let i = 0; i < 10; i++) {
            points.push({
                lat: -12.0400 + (i * 0.001),
                lng: -77.0400 + (i * 0.001),
                speed: 10,
                accuracy: 5,
                timestamp: startTime + (i * 30000)
            });
        }

        // Visit Client (Dwell)
        const visitStart = startTime + (15 * 60000);
        for (let i = 0; i < 15; i++) {
            points.push({
                lat: -12.0464,
                lng: -77.0428,
                speed: 0.1,
                accuracy: 3,
                timestamp: visitStart + (i * 60000) // 14 mins total (840s)
            });
        }

        // Driving away
        const escapeStart = visitStart + (20 * 60000); // 5 mins after visit ends
        for (let i = 0; i < 5; i++) {
            points.push({
                lat: -12.0470 + (i * 0.001),
                lng: -77.0430 + (i * 0.001),
                speed: 20,
                accuracy: 5,
                timestamp: escapeStart + (i * 30000)
            });
        }

        // Long stop without client (Far from Bodega Perez)
        const stopStart = escapeStart + (10 * 30000); // 5 mins after escape
        for (let i = 0; i < 15; i++) {
            points.push({
                lat: -12.1000, // Far away
                lng: -77.1000,
                speed: 0.2,
                accuracy: 5,
                timestamp: stopStart + (i * 60000) // 14 mins total -> should be SIN_MOVIMIENTO
            });
        }

        console.log(`✔ Generated ${points.length} mock points`);

        await processBatch(employeeId, points);
        console.log('✔ Batch processed');

        // Verify DB
        const visits = await pool.query('SELECT * FROM visits');
        console.log(`✔ Detected Visits: ${visits.rows.length}`);
        if (visits.rows.length > 0) {
            console.log(`   - Visit to client_id ${visits.rows[0].client_id} for ${visits.rows[0].duration}s`);
        }

        const events = await pool.query('SELECT state, COUNT(*) FROM state_events GROUP BY state');
        console.log('✔ State Events Summary:');
        events.rows.forEach(r => console.log(`   - ${r.state}: ${r.count}`));

    } catch (err) {
        console.error('❌ Verification Failed:', err);
    } finally {
        await pool.end();
    }
}

runVerification();
