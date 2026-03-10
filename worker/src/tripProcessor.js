const SemanticClassifier = require('./semanticClassifier');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'tracking',
});

const classifier = new SemanticClassifier(pool);

/// ============================================================================
/// FUNCIÓN: Compilar y simplificar ruta cuando viaje termina
/// ============================================================================
async function updateTripRoute(client, tripId) {
    try {
        const startTime = Date.now();

        const result = await client.query(`
            INSERT INTO trip_routes (trip_id, geom_full, geom_simplified, point_count_full, point_count_simplified)
            SELECT 
                $1,
                ST_MakeLine(ARRAY_AGG(geom ORDER BY timestamp))::geography,
                ST_SimplifyPreserveTopology(
                    ST_MakeLine(ARRAY_AGG(geom ORDER BY timestamp))::geometry,
                    0.00005
                )::geography,
                COUNT(*),
                ST_NPoints(ST_SimplifyPreserveTopology(
                    ST_MakeLine(ARRAY_AGG(geom ORDER BY timestamp))::geometry,
                    0.00005
                ))
            FROM locations
            WHERE trip_id = $1
            ON CONFLICT (trip_id) DO UPDATE SET
                geom_full = EXCLUDED.geom_full,
                geom_simplified = EXCLUDED.geom_simplified,
                point_count_full = EXCLUDED.point_count_full,
                point_count_simplified = EXCLUDED.point_count_simplified,
                updated_at = CURRENT_TIMESTAMP
            RETURNING point_count_full, point_count_simplified
        `, [tripId]);

        if (result.rows.length > 0) {
            const { point_count_full, point_count_simplified } = result.rows[0];
            const elapsed = Date.now() - startTime;
            const reduction = ((point_count_full - point_count_simplified) / point_count_full * 100).toFixed(1);

            console.log(
                `[SIMPLIFY] Trip ${tripId}: compiled ${point_count_full} points ` +
                `→ ${point_count_simplified} simplified (${reduction}% reduction) in ${elapsed}ms`
            );
        }
    } catch (err) {
        console.error(`[ERROR] Failed to update trip route for trip ${tripId}:`, err.message);
    }
}

/// ============================================================================
/// FUNCIÓN: Procesar lote de puntos GPS
/// ============================================================================
async function processBatch(employeeId, points) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Filtering noise
        const filteredPoints = classifier.filterPoints(points);
        if (filteredPoints.length === 0) {
            console.log(`[BATCH] Employee ${employeeId}: No valid points after filtering`);
            return;
        }

        // Find or create today's trip
        let res = await client.query(
            'SELECT id FROM trips WHERE employee_id = $1 AND DATE(start_time) = CURRENT_DATE AND is_active = TRUE LIMIT 1',
            [employeeId]
        );

        let tripId;
        if (res.rows.length === 0) {
            const newTrip = await client.query(
                'INSERT INTO trips (employee_id, is_active) VALUES ($1, TRUE) RETURNING id',
                [employeeId]
            );
            tripId = newTrip.rows[0].id;
        } else {
            tripId = res.rows[0].id;
        }

        // 2. Insert filtered points
        for (let p of filteredPoints) {
            await client.query(
                `INSERT INTO locations (trip_id, employee_id, latitude, longitude, speed, accuracy, timestamp, geom) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
                 ON CONFLICT DO NOTHING`,
                [tripId, employeeId, p.lat, p.lng, p.speed, p.accuracy, p.timestamp]
            );
        }

        // 3. Update distance
        await client.query(`
            UPDATE trips SET distance_meters = distance_meters + (
                SELECT COALESCE(SUM(distance), 0)
                FROM (
                    SELECT ST_Distance(
                        LAG(geom) OVER (ORDER BY timestamp),
                        geom
                    ) as distance
                    FROM locations
                    WHERE trip_id = $1
                ) q
                WHERE distance IS NOT NULL
            ) WHERE id = $1
        `, [tripId]);

        // 4. Clustering & Visit Inference
        const clusters = classifier.detectClusters(filteredPoints);
        const visits = await classifier.inferVisits(employeeId, clusters);

        for (const visit of visits) {
            await client.query(`
                INSERT INTO visits (employee_id, client_id, start_time, end_time, duration)
                VALUES ($1, $2, $3, $4, $5)
            `, [visit.employee_id, visit.client_id, visit.start_time, visit.end_time, visit.duration]);
        }

        // 5. Generate State Events
        await classifier.generateStateEvents(employeeId, tripId, filteredPoints, visits);

        await client.query('COMMIT');

        // Close trip if inactive
        const lastPointTime = await client.query(
            'SELECT MAX(timestamp) as last_timestamp FROM locations WHERE trip_id = $1',
            [tripId]
        );

        if (lastPointTime.rows[0] && lastPointTime.rows[0].last_timestamp) {
            let lastTs = lastPointTime.rows[0].last_timestamp;
            if (typeof lastTs === 'number' && lastTs > 9999999999) {
                lastTs = Math.floor(lastTs / 1000);
            }
            const secondsSinceLast = Math.floor(Date.now() / 1000) - lastTs;
            if (secondsSinceLast > 1800) {
                await client.query(
                    'UPDATE trips SET is_active = FALSE, end_time = NOW() WHERE id = $1',
                    [tripId]
                );
                await updateTripRoute(client, tripId);
            }
        }

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(`[ERROR] Failed to process batch for employee ${employeeId}:`, err.message);
        throw err;
    } finally {
        if (client) client.release();
    }
}

module.exports = { processBatch, updateTripRoute };
