const tripProcessor = require('./tripProcessor');
const stopDetector = require('./stopDetector');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'tracking',
});

async function processBatch(employeeId, points) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Find today's trip
        let res = await client.query(
            'SELECT id FROM trips WHERE employee_id = $1 AND DATE(start_time) = CURRENT_DATE LIMIT 1',
            [employeeId]
        );

        let tripId;
        if (res.rows.length === 0) {
            const newTrip = await client.query('INSERT INTO trips (employee_id) VALUES ($1) RETURNING id', [employeeId]);
            tripId = newTrip.rows[0].id;
        } else {
            tripId = res.rows[0].id;
        }

        // Insert points
        for (let p of points) {
            await client.query(
                `INSERT INTO locations (trip_id, employee_id, latitude, longitude, speed, accuracy, timestamp, geom) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
         ON CONFLICT DO NOTHING`,
                [tripId, employeeId, p.lat, p.lng, p.speed, p.accuracy, p.timestamp]
            );
        }

        // Update distance (simplified)
        await client.query(`
      UPDATE trips SET distance_meters = distance_meters + (
        SELECT COALESCE(SUM(ST_Distance(l1.geom, l2.geom)), 0)
        FROM locations l1
        JOIN locations l2 ON l1.trip_id = l2.trip_id AND l1.id = l2.id - 1
        WHERE l1.trip_id = $1
      ) WHERE id = $1
    `, [tripId]);

        // Detect stops
        await stopDetector.detectStops(client, tripId, employeeId);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { processBatch };
