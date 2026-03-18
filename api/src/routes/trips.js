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
            console.log(`[API] Trip ${tripId}: Fetching raw locations...`);
            const pointsResult = await db.query(`
                SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp, state
                FROM locations 
                WHERE trip_id = $1 
                ORDER BY timestamp ASC
            `, [tripId]);
            points = pointsResult.rows;
            console.log(`[API] Trip ${tripId}: Found ${points.length} raw points fallback`);
        }
        
        if (points.length === 0) {
            console.log(`[API] Trip ${tripId} WARNING: No points found in either trip_routes or locations!`);
            // Check if trip exists at all in locations with raw SQL for debugging
            const debugCount = await db.query('SELECT COUNT(*) FROM locations WHERE trip_id = $1', [tripId]);
            console.log(`[API] Trip ${tripId} DEBUG: Direct COUNT in locations table: ${debugCount.rows[0].count}`);
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
