const stopDetector = require('./stopDetector');
const osrmService = require('./osrmService');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'tracking',
    port: process.env.POSTGRES_PORT || 5432,
});

/// ============================================================================
/// FUNCIÓN: Calcular distancia Haversine en metros
/// ============================================================================
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la tierra en metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/// ============================================================================
/// FUNCIÓN: Compilar y simplificar ruta cuando viaje termina
/// ============================================================================
/// Usa ST_SimplifyPreserveTopology para reducir puntos manteniendo la topología
async function updateTripRoute(client, tripId) {
    try {
        const startTime = Date.now();

        // Obtener todos los puntos del viaje en orden cronológico
        const pointsResult = await client.query(`
            SELECT latitude, longitude FROM locations 
            WHERE trip_id = $1 
            ORDER BY timestamp ASC
        `, [tripId]);

        if (pointsResult.rows.length < 2) {
            console.log(`[SIMPLIFY] Trip ${tripId}: not enough points (${pointsResult.rows.length})`);
            return;
        }

        const pointCount = pointsResult.rows.length;

        // Crear LineString con todos los puntos
        const pointsGeom = pointsResult.rows
            .map(p => `${p.longitude} ${p.latitude}`)
            .join(',');

        // 2. Reconstruir ruta usando puntos MATCHED (Ajustada a carretera)
        await client.query(`
            WITH matched_route AS (
                SELECT ST_MakeLine(geom::geometry ORDER BY timestamp) AS geom_line
                FROM matched_locations
                WHERE trip_id = $1
            )
            INSERT INTO trip_routes (trip_id, geom_matched, updated_at)
            SELECT $1, geom_line::geography, CURRENT_TIMESTAMP
            FROM matched_route
            ON CONFLICT (trip_id) DO UPDATE SET
                geom_matched = EXCLUDED.geom_matched,
                updated_at = CURRENT_TIMESTAMP
        `, [tripId]);

        // 3. Generar y actualizar ruta simplificada/full
        const result = await client.query(`
            WITH route AS (
                SELECT ST_MakeLine(geom::geometry ORDER BY timestamp) AS geom_line,
                       COUNT(*) AS full_count
                FROM locations
                WHERE trip_id = $1 AND source != 'geoip' AND quality != 'low' AND quality != 'no_fix'
            )
            INSERT INTO trip_routes (
                trip_id, 
                geom_full, 
                geom_simplified, 
                point_count, 
                point_count_simplified
            )
            SELECT 
                $1,
                geom_line::geography,
                ST_SimplifyPreserveTopology(geom_line, 0.00001)::geography,
                full_count,
                ST_NPoints(ST_SimplifyPreserveTopology(geom_line, 0.00001))
            FROM route
            ON CONFLICT (trip_id) DO UPDATE SET
                geom_full = EXCLUDED.geom_full,
                geom_simplified = EXCLUDED.geom_simplified,
                point_count = EXCLUDED.point_count,
                point_count_simplified = EXCLUDED.point_count_simplified,
                updated_at = CURRENT_TIMESTAMP
            RETURNING point_count, point_count_simplified
        `, [tripId]);

        if (result.rows.length > 0) {
            const { point_count, point_count_simplified } = result.rows[0];
            const elapsed = Date.now() - startTime;
            const reduction = ((point_count - point_count_simplified) / point_count * 100).toFixed(1);

            console.log(
                `[SIMPLIFY] Trip ${tripId}: compiled ${point_count} points ` +
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
    if (!points || points.length === 0) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Sort points chronologically
        points.sort((a, b) => a.timestamp - b.timestamp);

        // 2. Group points into segments by 30-minute gaps
        const segments = [];
        let currentSegment = [points[0]];

        for (let i = 1; i < points.length; i++) {
            const gapMs = points[i].timestamp - points[i - 1].timestamp;
            if (gapMs > 1800000) { // > 30 minutes
                segments.push(currentSegment);
                currentSegment = [points[i]];
            } else {
                currentSegment.push(points[i]);
            }
        }
        segments.push(currentSegment);

        // 3. Process each segment
        for (const segment of segments) {
            const firstPoint = segment[0];
            const lastPoint = segment[segment.length - 1];
            
            // Find an existing active trip for this employee that is "recent enough"
            // (within 30 mins of the segment's first point)
            let tripId;
            const existingTripRes = await client.query(
                `SELECT id FROM trips 
                 WHERE employee_id = $1 
                 AND is_active = TRUE 
                 AND (
                   -- If the trip is active, ensure the new points aren't too far in the future
                   -- or too far in the past compared to the last recorded point in that trip.
                   ABS(EXTRACT(EPOCH FROM COALESCE(end_time, start_time)) * 1000 - $2) < 1800000
                 )
                 ORDER BY start_time DESC LIMIT 1`,
                [employeeId, firstPoint.timestamp]
            );

            if (existingTripRes.rows.length === 0) {
                // Create a new trip starting at the first point's timestamp
                const newTrip = await client.query(
                    'INSERT INTO trips (employee_id, is_active, start_time) VALUES ($1, TRUE, to_timestamp($2/1000.0)) RETURNING id',
                    [employeeId, firstPoint.timestamp]
                );
                tripId = newTrip.rows[0].id;
                console.log(`[TRIP] Created new trip ${tripId} for employee ${employeeId}`);
            } else {
                tripId = existingTripRes.rows[0].id;
            }

            // OBTENER EL ÚLTIMO PUNTO VÁLIDO (para filtrar saltos imposibles)
            let lastValidPoint = null;
            const lastPointRes = await client.query(
                'SELECT latitude as lat, longitude as lng, timestamp FROM locations WHERE trip_id = $1 ORDER BY timestamp DESC LIMIT 1',
                [tripId]
            );
            if (lastPointRes.rows.length > 0) {
                lastValidPoint = {
                    lat: parseFloat(lastPointRes.rows[0].lat),
                    lng: parseFloat(lastPointRes.rows[0].lng),
                    timestamp: parseInt(lastPointRes.rows[0].timestamp, 10)
                };
            }

            let validPoints = 0;
            let invalidPoints = 0;

            for (let p of segment) {
                // Validar coordenadas
                if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180 || (p.lat === 0 && p.lng === 0)) {
                    invalidPoints++;
                    continue;
                }

                // Validar timestamp (no puede ser futuro + 1 min tolerancia)
                if (p.timestamp > Date.now() + 60000) {
                    invalidPoints++;
                    continue;
                }

                // Validar saltos imposibles (>150km/h)
                if (lastValidPoint) {
                    const distanceMts = calculateDistanceMeters(lastValidPoint.lat, lastValidPoint.lng, p.lat, p.lng);
                    const timeDiffSec = Math.abs((p.timestamp - lastValidPoint.timestamp) / 1000.0);

                    if (timeDiffSec > 0 && distanceMts > 5) {
                        const speedKmh = (distanceMts / timeDiffSec) * 3.6;
                        if (speedKmh > 150) {
                            console.warn(`[VALIDATION] Skipping jump: ${speedKmh.toFixed(1)} km/h for trip ${tripId}`);
                            invalidPoints++;
                            continue;
                        }
                    }
                }

                // Insert point
                const query = `
                    INSERT INTO locations (
                        trip_id, employee_id, latitude, longitude, speed, accuracy, timestamp, 
                        geom, state, quality, source, reset_reason, confidence
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, 
                        ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 
                        $8, $9, $10, $11, $12
                    )
                    ON CONFLICT (employee_id, timestamp) DO NOTHING
                `;
                const values = [
                    tripId, employeeId, p.lat, p.lng, p.speed, p.accuracy, p.timestamp,
                    p.state || 'STOPPED', p.quality || 'high',
                    p.source || 'gps', p.reset_reason || null, p.confidence || 1.0
                ];
                await client.query(query, values);

                lastValidPoint = { lat: p.lat, lng: p.lng, timestamp: p.timestamp };
                validPoints++;
            }

            console.log(`[BATCH] Segment for Trip ${tripId}: ${validPoints} valid, ${invalidPoints} invalid`);

            // Update trip metadata (end_time and distance)
            if (validPoints > 0) {
                await client.query(
                    'UPDATE trips SET end_time = to_timestamp($1/1000.0) WHERE id = $2',
                    [lastPoint.timestamp, tripId]
                );

                // Update distance (ignorando puntos estimados por IP o ruidosos)
                await client.query(`
                    UPDATE trips SET distance_meters = (
                        SELECT COALESCE(SUM(dist), 0)
                        FROM (
                            SELECT ST_Distance(geom, LAG(geom) OVER (ORDER BY timestamp)) as dist
                            FROM locations WHERE trip_id = $1 AND source != 'geoip' AND quality != 'low' AND quality != 'no_fix'
                        ) q WHERE dist IS NOT NULL
                    ) WHERE id = $1
                `, [tripId]);

                // OSRM Map Matching
                // FIX: umbral bajado de 20 a 5 puntos — dispositivos 3G de gama baja
                // raramente acumulan 20 puntos entre envíos, así que antes nunca
                // se activaba el map-matching y las rutas saliían chuecas.
                const OSRM_MIN_POINTS = 5;
                const OSRM_CHUNK_SIZE = 100; // Límite máximo de OSRM por request

                const unmatchedResult = await client.query(
                    'SELECT id, latitude as lat, longitude as lng, speed, accuracy, timestamp FROM locations WHERE trip_id = $1 AND is_matched = FALSE AND quality != \'low\' AND quality != \'no_fix\' ORDER BY timestamp ASC',
                    [tripId]
                );

                if (unmatchedResult.rows.length >= OSRM_MIN_POINTS) {
                    const rawPoints = unmatchedResult.rows.map(r => ({
                        id: r.id, lat: parseFloat(r.lat), lng: parseFloat(r.lng),
                        speed: parseFloat(r.speed), accuracy: parseFloat(r.accuracy), timestamp: parseInt(r.timestamp)
                    }));
                    const processedPoints = osrmService.interpolateGaps(rawPoints);

                    // Dividir en chunks si hay más de 100 puntos (límite de OSRM)
                    const chunks = [];
                    for (let i = 0; i < processedPoints.length; i += OSRM_CHUNK_SIZE) {
                        chunks.push(processedPoints.slice(i, i + OSRM_CHUNK_SIZE));
                    }
                    console.log(`[OSRM] Trip ${tripId}: ${processedPoints.length} points → ${chunks.length} chunk(s)`);

                    const matchedIds = [];
                    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
                        const chunk = chunks[chunkIdx];
                        const matchData = await osrmService.matchSegment(chunk);

                        if (matchData && matchData.tracepoints) {
                            for (let i = 0; i < matchData.tracepoints.length; i++) {
                                const tp = matchData.tracepoints[i];
                                const originalP = chunk[i];
                                if (tp && tp.location) {
                                    await client.query(
                                        `INSERT INTO matched_locations (location_id, trip_id, latitude, longitude, geom, timestamp, speed, match_confidence, waypoint_index, road_name, is_interpolated)
                                         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6, $7, $8, $9, $10)
                                         ON CONFLICT DO NOTHING`,
                                        [originalP.id || null, tripId, tp.location[1], tp.location[0], originalP.timestamp, originalP.speed,
                                         matchData.matchings[tp.matchings_index]?.confidence || 0, tp.waypoint_index, tp.name || 'Unknown', originalP.is_interpolated || false]
                                    );
                                    if (originalP.id) matchedIds.push(originalP.id);
                                }
                            }
                            console.log(`[OSRM] Chunk ${chunkIdx + 1}/${chunks.length}: matched ${matchData.tracepoints.filter(t => t).length} points`);
                        } else {
                            console.warn(`[OSRM] Chunk ${chunkIdx + 1}/${chunks.length}: no match — usando GPS raw`);
                        }
                    }

                    if (matchedIds.length > 0) {
                        await client.query('UPDATE locations SET is_matched = TRUE WHERE id = ANY($1)', [matchedIds]);
                        
                        // ✅ PRO ARCHITECTURE: Compilar ambas rutas (Raw y Matched)
                        // Calculamos ratio de confianza real: puntos_matcheados / puntos_totales
                        await client.query(`
                            WITH stats AS (
                                SELECT
                                    (SELECT COUNT(*) FROM locations WHERE trip_id = $1) as total_pts,
                                    (SELECT COUNT(*) FROM matched_locations WHERE trip_id = $1) as matched_pts
                            ),
                            route_raw_geom AS (
                                SELECT ST_MakeLine(geom::geometry ORDER BY timestamp) as line
                                FROM locations
                                WHERE trip_id = $1 AND quality != 'low' AND quality != 'no_fix'
                            ),
                            route_matched_geom AS (
                                SELECT ST_MakeLine(geom::geometry ORDER BY timestamp) as line
                                FROM matched_locations
                                WHERE trip_id = $1
                            )
                            INSERT INTO trip_routes (
                                trip_id, 
                                geom_raw, 
                                geom_matched, 
                                point_count, 
                                point_count_matched, 
                                match_confidence
                            )
                            SELECT 
                                $1, 
                                ST_SimplifyPreserveTopology(route_raw_geom.line, 0.0001),
                                CASE WHEN (stats.matched_pts::float / NULLIF(stats.total_pts, 0)) > 0.6 
                                     THEN ST_SimplifyPreserveTopology(route_matched_geom.line, 0.0001) 
                                     ELSE NULL END,
                                stats.total_pts,
                                stats.matched_pts,
                                (stats.matched_pts::float / NULLIF(stats.total_pts, 0))
                            FROM stats, route_raw_geom, route_matched_geom
                            ON CONFLICT (trip_id) DO UPDATE SET
                                geom_raw = EXCLUDED.geom_raw,
                                geom_matched = EXCLUDED.geom_matched,
                                point_count = EXCLUDED.point_count,
                                point_count_matched = EXCLUDED.point_count_matched,
                                match_confidence = EXCLUDED.match_confidence,
                                updated_at = CURRENT_TIMESTAMP;
                        `, [tripId]);
                        console.log(`[OSRM] Trip ${tripId}: Pro architecture sync completed (Raw + Matched fallback)`);
                    }
                } else {
                    console.log(`[OSRM] Trip ${tripId}: solo ${unmatchedResult.rows.length} punto(s) sin matchear (mín: ${OSRM_MIN_POINTS}), usando GPS raw`);
                }

                // Stop detection
                await stopDetector.detectStops(client, tripId, employeeId);

                // Update Simplified Route
                await updateTripRoute(client, tripId);
            }
        }

        // 4. Cleanup: Close old active trips for this employee
        // (Any trip that hasn't seen activity in 30+ minutes)
        await client.query(
            `UPDATE trips SET is_active = FALSE, end_time = NOW() 
             WHERE employee_id = $1 AND is_active = TRUE 
             AND EXTRACT(EPOCH FROM (NOW() - COALESCE(end_time, start_time))) > 7200`,
            [employeeId]
        );

        await client.query('COMMIT');
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(`[ERROR] processBatch failed for employee ${employeeId}:`, err.message);
        throw err;
    } finally {
        if (client) client.release();
    }
}

async function syncSchema() {
    const maxRetries = 15;
    let retries = 0;

    while (retries < maxRetries) {
        let client;
        try {
            client = await pool.connect();
            // Wait for PostgreSQL to be ready
            await client.query('SELECT 1');

            // 4. Check for 'quality' column
            const checkQualityCol = await client.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='locations' AND column_name='quality';
            `);
            if (checkQualityCol.rowCount === 0) {
                console.log('Migrating database: Adding "quality" column...');
                await client.query('ALTER TABLE locations ADD COLUMN quality VARCHAR(20) DEFAULT \'high\'');
            }

            // ✅ NUEVO: source, reset_reason, confidence
            const checkNewCols = await client.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name='locations' AND column_name IN ('source', 'reset_reason', 'confidence');
            `);
            const existingCols = checkNewCols.rows.map(r => r.column_name);

            if (!existingCols.includes('source')) {
                await client.query('ALTER TABLE locations ADD COLUMN source VARCHAR(50) DEFAULT \'gps\'');
            }
            if (!existingCols.includes('reset_reason')) {
                await client.query('ALTER TABLE locations ADD COLUMN reset_reason TEXT');
            }
            if (!existingCols.includes('confidence')) {
                await client.query('ALTER TABLE locations ADD COLUMN confidence FLOAT DEFAULT 1.0');
            }

            // 3. Check for 'matched_locations' table
            const checkMatchedTable = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_name='matched_locations'
            `);
            if (checkMatchedTable.rowCount === 0) {
                console.log('Migrating database: Creating "matched_locations" table...');
                await client.query(`
                    CREATE TABLE IF NOT EXISTS matched_locations (
                        id SERIAL PRIMARY KEY,
                        location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
                        trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
                        geom GEOGRAPHY(Point, 4326),
                        latitude FLOAT NOT NULL,
                        longitude FLOAT NOT NULL,
                        speed FLOAT,
                        match_confidence FLOAT,
                        waypoint_index INTEGER,
                        road_name VARCHAR(255),
                        is_interpolated BOOLEAN DEFAULT FALSE,
                        timestamp BIGINT NOT NULL,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                await client.query('CREATE INDEX IF NOT EXISTS idx_matched_locations_trip_id ON matched_locations (trip_id)');
                await client.query('CREATE INDEX IF NOT EXISTS idx_matched_locations_time ON matched_locations (timestamp ASC)');
            }
            
            // 4. Check for 'source' column in 'stops'
            const checkSource = await client.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='stops' AND column_name='source';
            `);
            if (checkSource.rowCount === 0) {
                console.log('Migrating database: Adding "source" column to "stops"...');
                await client.query('ALTER TABLE stops ADD COLUMN source VARCHAR(10) DEFAULT \'auto\'');
            }

            // 5. Check for 'geom_raw' in 'trip_routes'
            const checkRaw = await client.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='trip_routes' AND column_name='geom_raw';
            `);
            if (checkRaw.rowCount === 0) {
                console.log('Migrating database: Adding "geom_raw" column to "trip_routes"...');
                await client.query('ALTER TABLE trip_routes ADD COLUMN geom_raw GEOGRAPHY(LineString, 4326)');
                await client.query('ALTER TABLE trip_routes ADD COLUMN IF NOT EXISTS point_count_matched INTEGER DEFAULT 0');
                await client.query('ALTER TABLE trip_routes ADD COLUMN IF NOT EXISTS match_confidence FLOAT DEFAULT 0');
            }

            // 6. Check for 'quality' column in 'locations'
            const checkQuality = await client.query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='locations' AND column_name='quality';
            `);
            if (checkQuality.rowCount === 0) {
                console.log('Migrating database: Adding "quality" column to "locations"...');
                await client.query('ALTER TABLE locations ADD COLUMN quality VARCHAR(20) DEFAULT \'high\'');
            }

            console.log('Database schema (Worker) sync completed.');
            return; // Success
        } catch (err) {
            retries++;
            const waitTime = Math.min(2000 * retries, 10000); // Max 10 seconds
            if (retries >= maxRetries) {
                console.warn('⚠️  Worker could not sync schema after ' + maxRetries + ' retries. Error: ' + err.message);
                return;
            }
            console.warn(`⏳ Schema sync attempt (Worker) ${retries}/${maxRetries} failed, retrying in ${waitTime / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        } finally {
            if (client) client.release();
        }
    }
}

module.exports = { processBatch, updateTripRoute, syncSchema, pool };
