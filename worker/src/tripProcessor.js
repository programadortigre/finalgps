const stopDetector = require('./stopDetector');
const osrmService = require('./osrmService');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'tracking',
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

        // ✅ CORRECTO: ST_SimplifyPreserveTopology conserva la topología
        // ❌ INCORRECTO: ST_Simplify($1::geography) causa errores de casting
        const simplifyResult = await client.query(`
            SELECT 
                ST_AsText(geom_full) as full_text,
                ST_AsText(geom_simplified) as simplified_text,
                ST_NPoints(geom_full) as count_full,
                ST_NPoints(geom_simplified) as count_simplified
            FROM (
                SELECT 
                    ST_MakeLine(
                        ARRAY[${pointsGeom.split(',').map((_, i) => `ST_Point(${pointsGeom.split(',')[i]})`).join(', ')}]
                    ) as geom_full,
                    ST_SimplifyPreserveTopology(
                        ST_MakeLine(
                            ARRAY[${pointsGeom.split(',').map((_, i) => `ST_Point(${pointsGeom.split(',')[i]})`).join(', ')}]
                        )::geometry,
                        0.00005  -- 5 metros de tolerancia (en grados decimales)
                    )::geography as geom_simplified
            ) q
        `);

        // 3. Reconstruir ruta usando puntos MATCHED (Ajustada a carretera)
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

        const result = await client.query(`
            WITH route AS (
                SELECT ST_MakeLine(geom::geometry ORDER BY timestamp) AS geom_line,
                       COUNT(*) AS full_count
                FROM locations
                WHERE trip_id = $1
            )
            INSERT INTO trip_routes (
                trip_id, 
                geom_full, 
                geom_simplified, 
                point_count_full, 
                point_count_simplified
            )
            SELECT 
                $1,
                geom_line::geography,
                ST_SimplifyPreserveTopology(geom_line, 0.00005)::geography,
                full_count,
                ST_NPoints(ST_SimplifyPreserveTopology(geom_line, 0.00005))
            FROM route
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

        // Find today's trip
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

        // ✅ OBTENER EL ÚLTIMO PUNTO VÁLIDO (para filtrar saltos imposibles)
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

        // ✅ VALIDACIÓN: Rechazar puntos con datos inválidos o saltos
        let validPoints = 0;
        let invalidPoints = 0;

        // Ordenar chronológicamente el batch para comparar bien
        points.sort((a, b) => a.timestamp - b.timestamp);

        for (let p of points) {
            // Validar coordenadas
            if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180 || (p.lat === 0 && p.lng === 0)) {
                console.warn(`[VALIDATION] Invalid or zero coordinates: lat=${p.lat}, lng=${p.lng}`);
                invalidPoints++;
                continue;
            }

            // Validar timestamp (no puede ser futuro + 1 min tolerancia)
            if (p.timestamp > Date.now() + 60000) {
                console.warn(`[VALIDATION] Invalid timestamp: ${new Date(p.timestamp)}`);
                invalidPoints++;
                continue;
            }

            // Validar saltos imposibles (>150km/h o >41m/s)
            if (lastValidPoint) {
                const distanceMts = calculateDistanceMeters(lastValidPoint.lat, lastValidPoint.lng, p.lat, p.lng);
                
                // Cuidado: algunos timestamps vienen en ms, la DB puede devolver en ms o seg según la inserción.
                // Asumimos que p.timestamp está en ms (Javascript standard)
                const timeDiffMst = p.timestamp - lastValidPoint.timestamp;
                const timeDiffSec = Math.abs(timeDiffMst / 1000.0);

                if (timeDiffSec > 0 && distanceMts > 5) {
                    const speedMps = distanceMts / timeDiffSec;
                    const speedKmh = speedMps * 3.6;

                    // Si la velocidad inferida es > 150 km/h, rechazar por salto de GPS
                    if (speedKmh > 150) {
                        console.warn(`[SIMPLIFY] Saltando punto GPS imposible: ${speedKmh.toFixed(1)} km/h. Distancia: ${distanceMts.toFixed(1)}m, Tiempo: ${timeDiffSec.toFixed(1)}s`);
                        invalidPoints++;
                        continue;
                    }
                }
            }

            // Insert point
            await client.query(
                `INSERT INTO locations (trip_id, employee_id, latitude, longitude, speed, accuracy, state, timestamp, geom) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
                 ON CONFLICT DO NOTHING`,
                [tripId, employeeId, p.lat, p.lng, p.speed, p.accuracy, p.state || 'STOPPED', p.timestamp]
            );

            // Actualizar referencia al último punto insertado en la iteración
            lastValidPoint = { lat: p.lat, lng: p.lng, timestamp: p.timestamp };
            validPoints++;
        }

        console.log(`[BATCH] Trip ${tripId}: inserted ${validPoints} valid points, rejected ${invalidPoints} (jumps/invalid)`);

        // Update distance using efficient Window Function
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

        // ✅ ENLAZAR CON MAP MATCHING (Segmentos de 20-50 puntos)
        // Buscamos puntos no procesados para este viaje
        const unmatchedResult = await client.query(
            'SELECT id, latitude as lat, longitude as lng, speed, accuracy, timestamp FROM locations WHERE trip_id = $1 AND is_matched = FALSE ORDER BY timestamp ASC',
            [tripId]
        );

        if (unmatchedResult.rows.length >= 20) {
            console.log(`[OSRM] Trip ${tripId}: procesando segmento de ${unmatchedResult.rows.length} puntos...`);
            const rawPoints = unmatchedResult.rows.map(r => ({
                id: r.id,
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lng),
                speed: parseFloat(r.speed),
                accuracy: parseFloat(r.accuracy),
                timestamp: parseInt(r.timestamp)
            }));

            // 1. Gap Detection & Interpolation
            const processedPoints = osrmService.interpolateGaps(rawPoints);

            // 2. OSRM Match
            const matchData = await osrmService.matchSegment(processedPoints);

            if (matchData && matchData.tracepoints) {
                for (let i = 0; i < matchData.tracepoints.length; i++) {
                    const tp = matchData.tracepoints[i];
                    const originalP = processedPoints[i];

                    if (tp && tp.location) {
                        await client.query(
                            `INSERT INTO matched_locations 
                            (location_id, trip_id, latitude, longitude, geom, timestamp, speed, heading, match_confidence, waypoint_index, road_name, road_type, is_interpolated)
                            VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6, $7, $8, $9, $10, $11, $12)`,
                            [
                                originalP.id || null, // null si es interpolado
                                tripId,
                                tp.location[1], // OSRM devuelve [lng, lat]
                                tp.location[0],
                                originalP.timestamp,
                                originalP.speed,
                                tp.waypoint_index, // waypoint index
                                matchData.matchings[tp.matchings_index] ? matchData.matchings[tp.matchings_index].confidence : 0,
                                tp.waypoint_index,
                                tp.name || 'Unknown Road',
                                '', // road type (annotations requeridas para más detalle)
                                originalP.is_interpolated || false
                            ]
                        );
                    }
                }
                
                // Marcar puntos originales como procesados
                const originalIds = rawPoints.map(p => p.id);
                await client.query(
                    'UPDATE locations SET is_matched = TRUE WHERE id = ANY($1)',
                    [originalIds]
                );
            }
        }

        // Detect stops using matched locations if available
        await stopDetector.detectStops(client, tripId, employeeId);

        await client.query('COMMIT');

        // ✅ COMPILAR RUTA cuando viaje se cierra (30+ min sin puntos o cierre manual)
        const lastPointTime = await client.query(
            'SELECT MAX(timestamp) as last_timestamp FROM locations WHERE trip_id = $1',
            [tripId]
        );

        if (lastPointTime.rows[0] && lastPointTime.rows[0].last_timestamp) {
            // Convertir timestamp (puede ser ms o segundos)
            let lastTs = lastPointTime.rows[0].last_timestamp;
            if (typeof lastTs === 'number' && lastTs > 9999999999) {
                // Es en millisegundos, convertir a segundos
                lastTs = Math.floor(lastTs / 1000);
            }

            const secondsSinceLast = Math.floor(Date.now() / 1000) - lastTs;

            if (secondsSinceLast > 1800) {  // 30 minutos
                console.log(`[CLOSE] Trip ${tripId}: closing due to ${secondsSinceLast}s inactivity (30min threshold)`);
                await client.query(
                    'UPDATE trips SET is_active = FALSE, end_time = NOW() WHERE id = $1',
                    [tripId]
                );
                await updateTripRoute(client, tripId);
            }
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[ERROR] Failed to process batch for employee ${employeeId}:`, err.message);
        throw err;
    } finally {
        client.release();
    }
}

async function syncSchema() {
    let client;
    try {
        client = await pool.connect();
        const checkColumn = await client.query(`
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='locations' AND column_name='state';
        `);

        if (checkColumn.rowCount === 0) {
            console.log('Migrating database (Worker): Adding "state" column...');
            await client.query(`
                ALTER TABLE locations ADD COLUMN state VARCHAR(30) DEFAULT 'SIN_MOVIMIENTO';
            `);
            console.log('Migration completed successfully.');
        }
    } catch (err) {
        console.error('Error during schema synchronization (Worker):', err);
    } finally {
        if (client) client.release();
    }
}

module.exports = { processBatch, updateTripRoute, syncSchema };
