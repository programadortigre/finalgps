const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db/postgres');

// Get all employees (for admin)
router.get('/employees', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    try {
        const result = await db.query('SELECT id, name, email, is_tracking_enabled FROM employees WHERE role = \'employee\'');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Obtener los últimos recorridos del día de TODOS los empleados (BULK)
// Evita N+1 solicitudes desde el Dashboard
router.get('/latest-trails', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const start = Date.now();
    try {
        const { tzOffset = '-00:00' } = req.query;
        
        // Query optimizada: un solo paso para traer todos los trails pre-compilados
        // ✅ PRO FIX: Calcular 'Hoy' en la zona horaria del cliente para evitar dashboard vacío en la noche
        // ✅ PRO FIX: Si el viaje está activo (is_active = true), incluirlo siempre aunque haya empezado ayer
        const result = await db.query(`
            SELECT DISTINCT ON (e.id)
                e.id as "employeeId",
                e.name,
                t.id as "tripId",
                ST_AsGeoJSON(COALESCE(tr.geom_matched, tr.geom_raw)) as "points_json",
                tr.match_confidence as confidence
            FROM employees e
            LEFT JOIN trips t ON e.id = t.employee_id 
                AND (DATE(t.start_time AT TIME ZONE 'UTC' AT TIME ZONE $1) = DATE(CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE $1) OR t.is_active = true)
            LEFT JOIN trip_routes tr ON t.id = tr.trip_id
            WHERE e.role = 'employee'
            ORDER BY e.id, t.start_time DESC
        `, [tzOffset]);

        const processed = await Promise.all(result.rows.map(async row => {
            let points = [];
            if (row.points_json) {
                try {
                    const geojson = JSON.parse(row.points_json);
                    // No devolvemos miles de puntos, el frontend no los necesita para el live trail
                    // Limitamos a los últimos 500 puntos por seguridad de payload
                    points = geojson.coordinates.slice(-500).map(c => ({ lat: c[1], lng: c[0] }));
                } catch (e) { /* fallback vacío */ }
            } else if (row.tripId) {
                // ✅ PRO FIX: Si el viaje está activo y no tiene ruta final (empaquetada),
                // sacamos los puntos recientes directo de la tabla locations
                try {
                    const locResult = await db.query(`
                        SELECT latitude as lat, longitude as lng 
                        FROM locations 
                        WHERE trip_id = $1 
                        AND quality != 'no_fix'
                        ORDER BY timestamp DESC LIMIT 500
                    `, [row.tripId]);
                    points = locResult.rows.reverse(); // Reverse para mantener orden cronológico
                } catch (e) {
                    console.error('[API] Error fetching live points fallback:', e.message);
                }
            }
            
            return {
                employeeId: row.employeeId,
                name: row.name,
                tripId: row.tripId,
                points: points,
                confidence: row.confidence
            };
        }));

        const elapsed = Date.now() - start;
        const payloadSize = JSON.stringify(processed).length;
        
        console.log(`[PERF] /latest-trails: ${processed.length} employees, ${Math.round(payloadSize/1024)}KB, ${elapsed}ms`);

        res.json(processed);
    } catch (err) {
        console.error('[ERROR] Failed to fetch bulk latest trails:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get trips for a specific date and employee
router.get('/', auth, async (req, res) => {
    const { employeeId, date, tzOffset = '-00:00' } = req.query; // date: YYYY-MM-DD, tzOffset: e.g. -05:00
    const userId = req.user.role === 'admin' ? employeeId : req.user.id;

    if (!userId || !date) {
        return res.status(400).json({ error: 'employeeId and date are required' });
    }

    try {
        // ✅ PRO FIX: Filtrar usando la zona horaria del cliente para evitar saltos de día UTC
        const result = await db.query(`
            SELECT 
                id, 
                start_time, 
                end_time, 
                distance_meters,
                TO_CHAR(start_time AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') as start_time_formatted,
                TO_CHAR(end_time AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') as end_time_formatted,
                EXTRACT(EPOCH FROM (end_time - start_time))::int as duration_seconds,
                ROUND((distance_meters::numeric / 1000)::numeric, 2) as distance_km
            FROM trips 
            WHERE employee_id = $1 
            AND DATE(start_time AT TIME ZONE 'UTC' AT TIME ZONE $3) = $2
            ORDER BY start_time DESC
        `, [userId, date, tzOffset]);

        res.json(result.rows);
    } catch (err) {
        console.error('[ERROR] Failed to get trips:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Obtener historial de paradas por rango de fechas (CON PAGINACIÓN)
// GET /api/trips/stops/history/:employeeId?page=1&limit=50
router.get('/stops/history/:employeeId', auth, async (req, res) => {
    const employeeId = req.params.employeeId;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;

    // Validar autorización (admin o propietario)
    if (req.user.role !== 'admin' && req.user.id !== parseInt(employeeId)) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(10, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    try {
        // Total count
        const countResult = await db.query(`
            SELECT COUNT(*) as total FROM stops s
            INNER JOIN trips t ON s.trip_id = t.id
            WHERE s.employee_id = $1
            AND DATE(s.start_time AT TIME ZONE 'UTC' AT TIME ZONE '-05:00') <= $3
            AND DATE(COALESCE(s.end_time, CURRENT_TIMESTAMP) AT TIME ZONE 'UTC' AT TIME ZONE '-05:00') >= $2

        `, [employeeId, startDate, endDate]);

        const result = await db.query(`
            SELECT 
                s.id,
                s.latitude,
                s.longitude,
                TO_CHAR(s.start_time, 'YYYY-MM-DD') as stop_date,
                TO_CHAR(s.start_time, 'HH24:MI') as start_time_formatted,
                TO_CHAR(s.end_time, 'HH24:MI') as end_time_formatted,
                EXTRACT(EPOCH FROM (s.end_time - s.start_time))::int as duration_seconds,
                t.id as trip_id,
                s.start_time,
                s.end_time,
                s.duration_seconds as duration_seconds_original
            FROM stops s
            INNER JOIN trips t ON s.trip_id = t.id
            WHERE s.employee_id = $1
            AND DATE(s.start_time) >= $2
            AND DATE(s.start_time) <= $3
            ORDER BY s.start_time DESC
            LIMIT $4 OFFSET $5
        `, [employeeId, startDate, endDate, limitNum, offset]);

        const stops = result.rows.map(stop => ({
            id: stop.id,
            latitude: parseFloat(stop.latitude).toFixed(5),
            longitude: parseFloat(stop.longitude).toFixed(5),
            stop_date: stop.stop_date,
            start_time_formatted: stop.start_time_formatted,
            end_time_formatted: stop.end_time_formatted,
            duration_formatted: stop.duration_seconds ? `${Math.floor(stop.duration_seconds / 60)}m ${stop.duration_seconds % 60}s` : '-',
            trip_id: stop.trip_id,
            // Mantener para compatibilidad
            start_time: stop.start_time,
            end_time: stop.end_time,
            duration_seconds: stop.duration_seconds
        }));

        res.json({
            count: stops.length,
            total: parseInt(countResult.rows[0].total),
            page: pageNum,
            limit: limitNum,
            hasMore: (pageNum * limitNum) < parseInt(countResult.rows[0].total),
            stops: stops
        });
    } catch (err) {
        console.error('[ERROR] Failed to get stops history:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Obtener historial de viajes por rango de fechas (CON PAGINACIÓN Y DATOS PRE-PROCESADOS)
// GET /api/trips/history/:employeeId?page=1&limit=50
router.get('/history/:employeeId', auth, async (req, res) => {
    const employeeId = req.params.employeeId;
    const { startDate, endDate, page = 1, limit = 50, tzOffset = '-00:00' } = req.query;

    // Validar autorización (admin o propietario)
    if (req.user.role !== 'admin' && req.user.id !== parseInt(employeeId)) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(10, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    try {
        console.log(`[TRIPS] History request: employeeId=${employeeId}, dates=${startDate} to ${endDate}, page=${pageNum}, limit=${limitNum}, tz=${tzOffset}`);
        
        // Total count
        const countResult = await db.query(`
            SELECT COUNT(*) as total FROM trips t
            WHERE t.employee_id = $1
            AND DATE(t.start_time AT TIME ZONE 'UTC' AT TIME ZONE $4) >= $2
            AND DATE(t.start_time AT TIME ZONE 'UTC' AT TIME ZONE $4) <= $3

        `, [employeeId, startDate, endDate, tzOffset]);

        // Paginated results with pre-formatted data
        const result = await db.query(`
            SELECT 
                t.id,
                TO_CHAR(t.start_time AT TIME ZONE 'UTC' AT TIME ZONE $6, 'YYYY-MM-DD') as trip_date,
                TO_CHAR(t.start_time AT TIME ZONE 'UTC' AT TIME ZONE $6, 'HH24:MI') as start_time_formatted,
                TO_CHAR(t.end_time AT TIME ZONE 'UTC' AT TIME ZONE $6, 'HH24:MI') as end_time_formatted,
                EXTRACT(EPOCH FROM (t.end_time - t.start_time))::int as duration_seconds,
                ROUND((t.distance_meters::numeric / 1000)::numeric, 2) as distance_km,
                t.is_active,
                (SELECT COUNT(*) FROM stops WHERE trip_id = t.id) as stop_count,
                (SELECT COUNT(*) FROM locations WHERE trip_id = t.id) as point_count,
                t.start_time,
                t.end_time,
                t.distance_meters
            FROM trips t
            WHERE t.employee_id = $1
            AND DATE(t.start_time AT TIME ZONE 'UTC' AT TIME ZONE $6) >= $2
            AND DATE(t.start_time AT TIME ZONE 'UTC' AT TIME ZONE $6) <= $3
            ORDER BY t.start_time DESC

            LIMIT $4 OFFSET $5
        `, [employeeId, startDate, endDate, limitNum, offset, tzOffset]);

        console.log(`[TRIPS] Found ${result.rows.length} trips for employee ${employeeId}`);

        const trips = result.rows.map(trip => ({
            id: trip.id,
            trip_date: trip.trip_date,
            start_time_formatted: trip.start_time_formatted,
            end_time_formatted: trip.end_time_formatted,
            duration_hours: (trip.duration_seconds / 3600).toFixed(2),
            duration_minutes: Math.floor(trip.duration_seconds / 60),
            distance_km: trip.distance_km,
            distance_meters: trip.distance_meters,
            stop_count: trip.stop_count,
            point_count: trip.point_count,
            is_active: trip.is_active,
            // Mantener timestamps originales para compatibilidad
            start_time: trip.start_time,
            end_time: trip.end_time
        }));

        res.json({
            count: trips.length,
            total: parseInt(countResult.rows[0].total),
            page: pageNum,
            limit: limitNum,
            hasMore: (pageNum * limitNum) < parseInt(countResult.rows[0].total),
            trips: trips
        });
    } catch (err) {
        console.error('[ERROR] Failed to get trips history:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Obtener historial de eventos (GPS ON/OFF) por rango de fechas (CON PAGINACIÓN)
// GET /api/trips/events/history/:employeeId?page=1&limit=50
router.get('/events/history/:employeeId', auth, async (req, res) => {
    const employeeId = req.params.employeeId;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;

    if (req.user.role !== 'admin' && req.user.id !== parseInt(employeeId)) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(10, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    try {
        // Total count
        const countResult = await db.query(`
            WITH ranked_locations AS (
                SELECT 
                    timestamp, state,
                    LAG(state) OVER (ORDER BY timestamp) as prev_state,
                    LAG(timestamp) OVER (ORDER BY timestamp) as prev_timestamp
                FROM locations
                WHERE employee_id = $1 
                AND timestamp >= EXTRACT(EPOCH FROM $2::timestamp) * 1000
                AND timestamp <= EXTRACT(EPOCH FROM ($3::timestamp + INTERVAL '1 day')) * 1000
            )
            SELECT COUNT(*) as total FROM ranked_locations
            WHERE state != COALESCE(prev_state, '')
            AND (state = 'GPS_OFF' OR state = 'NO_FIX' OR prev_state = 'GPS_OFF' OR prev_state = 'NO_FIX')
        `, [employeeId, startDate, endDate]);

        const result = await db.query(`
            WITH ranked_locations AS (
                SELECT 
                    timestamp, state,
                    LAG(state) OVER (ORDER BY timestamp) as prev_state,
                    LAG(timestamp) OVER (ORDER BY timestamp) as prev_timestamp
                FROM locations
                WHERE employee_id = $1 
                AND timestamp >= EXTRACT(EPOCH FROM $2::timestamp) * 1000
                AND timestamp <= EXTRACT(EPOCH FROM ($3::timestamp + INTERVAL '1 day')) * 1000
            )
            SELECT * FROM ranked_locations
            WHERE state != COALESCE(prev_state, '')
            AND (state = 'GPS_OFF' OR state = 'NO_FIX' OR prev_state = 'GPS_OFF' OR prev_state = 'NO_FIX')
            ORDER BY timestamp DESC
            LIMIT $4 OFFSET $5
        `, [employeeId, startDate, endDate, limitNum, offset]);

        const events = result.rows.map(row => {
            let eventType = 'UNKNOWN';
            if (row.state === 'GPS_OFF' || row.state === 'NO_FIX') {
                eventType = 'GPS_OFF';
            } else if (row.prev_state === 'GPS_OFF' || row.prev_state === 'NO_FIX') {
                eventType = 'GPS_ON';
            }
            
            const eventDate = new Date(row.timestamp);
            const durationOff = eventType === 'GPS_ON' ? Math.round((row.timestamp - row.prev_timestamp) / 1000) : null;
            const durationOffFormatted = durationOff ? `${Math.floor(durationOff / 60)}m ${durationOff % 60}s` : null;
            
            return {
                timestamp: row.timestamp,
                event_date: eventDate.toLocaleDateString('es-PE'),
                event_time: eventDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
                state: row.state,
                event_type: eventType,
                reset_reason: row.reset_reason,
                duration_off_seconds: durationOff,
                duration_off_formatted: durationOffFormatted
            };
        });

        res.json({ 
            count: events.length,
            total: parseInt(countResult.rows[0].total),
            page: pageNum,
            limit: limitNum,
            hasMore: (pageNum * limitNum) < parseInt(countResult.rows[0].total),
            events 
        });
    } catch (err) {
        console.error('[ERROR] Failed to get events history:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get details of a single trip (route + stops)
// NUEVO: Soporta ?simplify=true para obtener ruta compilada en lugar de todos los puntos
router.get('/:id', auth, async (req, res) => {
    const tripId = req.params.id;
    const simplify = req.query.simplify === 'true';  // Nuevo parámetro

    try {
        // 1. Get trip info
        const tripResult = await db.query('SELECT * FROM trips WHERE id = $1', [tripId]);
        if (tripResult.rows.length === 0) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        // 2. Get route points (Soporta simplificación)
        let points = [];
        if (simplify) {
            console.log(`[API] Trip ${tripId}: Fetching Pro dual-path (Raw + Matched) from trip_routes...`);
            // ✅ PRO ARCHITECTURE: Devolvemos ambas opciones y dejamos que el sistema decida la mejor
            const routesResult = await db.query(`
                SELECT 
                    ST_AsGeoJSON(geom_raw) as raw_json,
                    ST_AsGeoJSON(geom_matched) as matched_json,
                    match_confidence as confidence
                FROM trip_routes 
                WHERE trip_id = $1
            `, [tripId]);
            
            if (routesResult.rows.length > 0) {
                const row = routesResult.rows[0];
                const rawGeojson = row.raw_json ? JSON.parse(row.raw_json) : null;
                const matchedGeojson = row.matched_json ? JSON.parse(row.matched_json) : null;
                
                // Decisión "Pro": Si la confianza es alta (> 0.6), usamos matcheado. 
                // Si es baja (parques, zonas rurales), usamos raw suavizado.
                if (row.confidence > 0.6 && matchedGeojson) {
                    points = matchedGeojson.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
                    console.log(`[API] Trip ${tripId}: High confidence (${(row.confidence*100).toFixed(0)}%). Using SNAPPED path.`);
                } else if (rawGeojson) {
                    points = rawGeojson.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
                    console.log(`[API] Trip ${tripId}: Low confidence (${(row.confidence*100).toFixed(0)}%). Using RAW (Kalman) path.`);
                }
            } else {
                console.log(`[API] Trip ${tripId}: No pre-compiled Pro routes found`);
            }
        }

        // Si no se usó simplificación o falló el fallback
        if (points.length === 0) {
            console.log(`[API] Trip ${tripId}: Fetching filtered and smoothed fallback...`);
            // ✅ MEJORA: Usar PostGIS para filtrar basura y simplificar al vuelo en el fallback
            const fallbackResult = await db.query(`
                WITH trip_points AS (
                    SELECT geom::geometry, timestamp
                    FROM locations 
                    WHERE trip_id = $1 
                    AND quality != 'no_fix' AND quality != 'low' 
                    AND accuracy < 50 -- Filtro MUY agresivo anti-jitter (Bajado de 100)
                    ORDER BY timestamp ASC
                ),
                smoothed_line AS (
                    SELECT ST_SimplifyPreserveTopology(ST_MakeLine(geom ORDER BY timestamp), 0.0001) as geom_line
                    FROM trip_points
                )
                SELECT ST_AsGeoJSON(geom_line) as simplified_json
                FROM smoothed_line
                WHERE geom_line IS NOT NULL
            `, [tripId]);

            if (fallbackResult.rows.length > 0 && fallbackResult.rows[0].simplified_json) {
                const geojson = JSON.parse(fallbackResult.rows[0].simplified_json);
                points = geojson.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
                console.log(`[API] Trip ${tripId}: Generated ${points.length} points via On-The-Fly Simplification fallback`);
            } else {
                // Fallback de ultra-emergencia: Puntos crudos pero filtrados
                const emergencyResult = await db.query(`
                    SELECT latitude as lat, longitude as lng, timestamp
                    FROM locations 
                    WHERE trip_id = $1 
                    AND quality = 'high' AND accuracy < 50
                    ORDER BY timestamp ASC LIMIT 500
                `, [tripId]);
                points = emergencyResult.rows;
                console.log(`[API] Trip ${tripId}: Emergency fallback using ${points.length} raw high-quality points`);
            }
        }

        // 3. Get stops
        const stopsResult = await db.query(`
            SELECT latitude as lat, longitude as lng, start_time, end_time, duration_seconds
            FROM stops 
            WHERE trip_id = $1 
            ORDER BY start_time ASC
        `, [tripId]);

        res.json({
            trip: tripResult.rows[0],
            points: points,
            stops: stopsResult.rows,
            metadata: {
                point_count: points.length,
                stop_count: stopsResult.rows.length,
                is_simplified: simplify && points.length > 0
            }
        });
    } catch (err) {
        console.error(`[ERROR] Failed to get trip ${tripId}:`, err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Cerrar viaje manualmente (cuando usuario detiene tracking)
// PATCH /api/trips/:id/close
router.patch('/:id/close', auth, async (req, res) => {
    const tripId = req.params.id;

    try {
        // Verificar que el viaje pertenece al usuario o es admin
        const tripResult = await db.query(
            'SELECT * FROM trips WHERE id = $1',
            [tripId]
        );

        if (tripResult.rows.length === 0) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        const trip = tripResult.rows[0];

        // Verificar autorización (admin o propietario del viaje)
        if (req.user.role !== 'admin' && trip.employee_id !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to close this trip' });
        }

        // Cerrar viaje
        const closeResult = await db.query(
            'UPDATE trips SET is_active = FALSE, end_time = NOW() WHERE id = $1 RETURNING *',
            [tripId]
        );

        // ✅ NUEVO: Compilar y simplificar ruta inmediatamente (Douglas-Peucker via PostGIS)
        try {
            await db.query(`
                WITH route AS (
                    SELECT ST_MakeLine(ARRAY_AGG(geom ORDER BY timestamp)) AS geom_line,
                           COUNT(*) AS full_count
                    FROM locations
                    WHERE trip_id = $1
                )
                INSERT INTO trip_routes (
                    trip_id, 
                    geom_full, 
                    geom_raw, 
                    point_count, 
                    point_count_simplified,
                    updated_at
                )
                SELECT
                    $1,
                    geom_line::geography,
                    ST_SimplifyPreserveTopology(geom_line, 0.0001)::geography,
                    full_count,
                    ST_NPoints(ST_SimplifyPreserveTopology(geom_line, 0.0001)),
                    CURRENT_TIMESTAMP
                FROM route
                ON CONFLICT (trip_id) DO UPDATE SET
                    geom_full = EXCLUDED.geom_full,
                    geom_raw = EXCLUDED.geom_raw,
                    point_count = EXCLUDED.point_count,
                    point_count_simplified = EXCLUDED.point_count_simplified,
                    updated_at = CURRENT_TIMESTAMP;
            `, [tripId]);
            console.log(`[API] Trip ${tripId}: route simplified successfully (optimized query)`);
        } catch (simplifyErr) {
            console.error(`[WARNING] Trip ${tripId}: failed to simplify route:`, simplifyErr.message);
            // No fallamos el request principal si falla la simplificación
        }

        console.log(`[API] Trip ${tripId}: closed by ${req.user.name}`);

        res.json({
            success: true,
            message: `Trip ${tripId} closed successfully`,
            trip: closeResult.rows[0]
        });
    } catch (err) {
        console.error(`[ERROR] Failed to close trip ${tripId}:`, err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
