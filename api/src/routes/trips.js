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

// Get trips for a specific date and employee
router.get('/', auth, async (req, res) => {
    const { employeeId, date } = req.query; // date format: YYYY-MM-DD
    const userId = req.user.role === 'admin' ? employeeId : req.user.id;

    if (!userId || !date) {
        return res.status(400).json({ error: 'employeeId and date are required' });
    }

    try {
        const result = await db.query(`
      SELECT id, start_time, end_time, distance_meters 
      FROM trips 
      WHERE employee_id = $1 
      AND DATE(start_time) = $2
      ORDER BY start_time DESC
    `, [userId, date]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Obtener historial de paradas por rango de fechas
// GET /api/trips/stops/history/:employeeId
router.get('/stops/history/:employeeId', auth, async (req, res) => {
    const employeeId = req.params.employeeId;
    const { startDate, endDate } = req.query;

    // Validar autorización (admin o propietario)
    if (req.user.role !== 'admin' && req.user.id !== parseInt(employeeId)) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }

    try {
        const result = await db.query(`
            SELECT 
                s.id,
                s.latitude,
                s.longitude,
                s.start_time,
                s.end_time,
                s.duration_seconds,
                t.id as trip_id,
                DATE(s.start_time) as stop_date
            FROM stops s
            INNER JOIN trips t ON s.trip_id = t.id
            WHERE s.employee_id = $1
            AND DATE(s.start_time) >= $2
            AND DATE(s.start_time) <= $3
            ORDER BY s.start_time DESC
        `, [employeeId, startDate, endDate]);

        res.json({
            count: result.rows.length,
            stops: result.rows
        });
    } catch (err) {
        console.error('[ERROR] Failed to get stops history:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Obtener historial de viajes por rango de fechas
// GET /api/trips/history/:employeeId
router.get('/history/:employeeId', auth, async (req, res) => {
    const employeeId = req.params.employeeId;
    const { startDate, endDate } = req.query;

    // Validar autorización (admin o propietario)
    if (req.user.role !== 'admin' && req.user.id !== parseInt(employeeId)) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }

    try {
        console.log(`[TRIPS] History request: employeeId=${employeeId}, dates=${startDate} to ${endDate}, role=${req.user.role}`);
        
        const result = await db.query(`
            SELECT 
                t.id,
                t.start_time,
                t.end_time,
                t.distance_meters,
                t.is_active,
                (SELECT COUNT(*) FROM stops WHERE trip_id = t.id) as stop_count,
                (SELECT COUNT(*) FROM locations WHERE trip_id = t.id) as point_count,
                DATE(t.start_time) as trip_date
            FROM trips t
            WHERE t.employee_id = $1
            AND DATE(t.start_time) >= $2
            AND DATE(t.start_time) <= $3
            ORDER BY t.start_time DESC
        `, [employeeId, startDate, endDate]);

        console.log(`[TRIPS] Found ${result.rows.length} trips for employee ${employeeId}`);

        const trips = result.rows.map(trip => ({
            ...trip,
            duration_minutes: trip.end_time ? 
                Math.round((new Date(trip.end_time) - new Date(trip.start_time)) / 60000) : 
                null,
            duration_hours: trip.end_time ?
                ((new Date(trip.end_time) - new Date(trip.start_time)) / 3600000).toFixed(2) :
                null
        }));

        res.json({
            count: trips.length,
            trips: trips
        });
    } catch (err) {
        console.error('[ERROR] Failed to get trips history:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ ENDPOINT: Obtener historial de eventos (GPS ON/OFF) por rango de fechas
// GET /api/trips/events/history/:employeeId
router.get('/events/history/:employeeId', auth, async (req, res) => {
    const employeeId = req.params.employeeId;
    const { startDate, endDate } = req.query;

    if (req.user.role !== 'admin' && req.user.id !== parseInt(employeeId)) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    try {
        const result = await db.query(`
            WITH ranked_locations AS (
                SELECT 
                    timestamp, state, reset_reason, quality, confidence,
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
            LIMIT 1000
        `, [employeeId, startDate, endDate]);

        const events = result.rows.map(row => {
            let eventType = 'UNKNOWN';
            if (row.state === 'GPS_OFF' || row.state === 'NO_FIX') {
                eventType = 'GPS_OFF';
            } else if (row.prev_state === 'GPS_OFF' || row.prev_state === 'NO_FIX') {
                eventType = 'GPS_ON';
            }
            
            return {
                timestamp: row.timestamp,
                state: row.state,
                event_type: eventType,
                reset_reason: row.reset_reason,
                duration_off_seconds: eventType === 'GPS_ON' ? Math.round((row.timestamp - row.prev_timestamp) / 1000) : null
            };
        });

        res.json({ events });
    } catch (err) {
        console.error('[ERROR] Failed to get events history:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get details of a single trip (route + stops)
// NUEVO: Soporta ?simplify=true para obtener ruta compilada en lugar de todos los puntos
router.get('/:id', auth, async (req, res) => {
    try {
        const tripId = req.params.id;
        const mode = req.query.mode || (req.query.simplify === 'true' ? 'pro' : 'raw');

        // 1. Get trip info
        const tripResult = await db.query('SELECT * FROM trips WHERE id = $1', [tripId]);
        if (tripResult.rows.length === 0) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        // 2. Get route points based on MODE
        let points = [];
        let usedMode = mode;

        if (mode === 'raw') {
            console.log(`[API] Trip ${tripId}: Fetching ABSOLUTE RAW points...`);
            const rawResult = await db.query(`
                SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp, state
                FROM locations 
                WHERE trip_id = $1 
                ORDER BY timestamp ASC
            `, [tripId]);
            points = rawResult.rows;
        } else if (mode === 'pro') {
            const routesResult = await db.query(`
                SELECT 
                    ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom_raw::geometry, 0.0001)) as raw_json,
                    ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom_matched::geometry, 0.0001)) as matched_json,
                    match_confidence as confidence
                FROM trip_routes 
                WHERE trip_id = $1
            `, [tripId]);
            
            if (routesResult.rows.length > 0) {
                const row = routesResult.rows[0];
                const rawGeojson = row.raw_json ? JSON.parse(row.raw_json) : null;
                const matchedGeojson = row.matched_json ? JSON.parse(row.matched_json) : null;
                
                if (row.confidence > 0.6 && matchedGeojson) {
                    points = matchedGeojson.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
                } else if (rawGeojson) {
                    points = rawGeojson.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
                }
            }
            
            if (points.length === 0) {
                usedMode = 'smooth';
            }
        }

        // Modo 'smooth' (o fallback de Pro)
        if (mode === 'smooth' || (usedMode === 'smooth' && points.length === 0)) {
            const fallbackResult = await db.query(`
                WITH trip_points AS (
                    SELECT geom::geometry, timestamp
                    FROM locations 
                    WHERE trip_id = $1 
                    AND quality != 'no_fix' AND quality != 'low' 
                    AND accuracy < 50 
                    ORDER BY timestamp ASC
                ),
                smoothed_line AS (
                    SELECT ST_SimplifyPreserveTopology(ST_MakeLine(geom ORDER BY timestamp), 0.0002) as geom_line
                    FROM trip_points
                )
                SELECT ST_AsGeoJSON(geom_line) as simplified_json
                FROM smoothed_line
                WHERE geom_line IS NOT NULL
            `, [tripId]);

            if (fallbackResult.rows.length > 0 && fallbackResult.rows[0].simplified_json) {
                const geojson = JSON.parse(fallbackResult.rows[0].simplified_json);
                points = geojson.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
            } else {
                const emergencyResult = await db.query(`
                    SELECT latitude as lat, longitude as lng, timestamp
                    FROM locations 
                    WHERE trip_id = $1 
                    AND quality = 'high' AND accuracy < 35 AND speed > 0.3
                    ORDER BY timestamp ASC LIMIT 400
                `, [tripId]);
                points = emergencyResult.rows;
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
