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
        const result = await db.query('SELECT id, name, email FROM employees WHERE role = \'employee\'');
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

        // 2. Get route points (simplificados o completos según parámetro)
        let pointsResult;
        if (simplify) {
            // ✅ OPTIMIZADO: Usar ruta simplificada de trip_routes
            // (~120 puntos en lugar de 1920 = 88% reducción en tamaño)
            pointsResult = await db.query(`
                SELECT 
                    ST_AsGeoJSON(geom_simplified)::json as geom,
                    point_count_simplified as point_count,
                    TRUE as is_simplified
                FROM trip_routes
                WHERE trip_id = $1
            `, [tripId]);

            if (pointsResult.rows.length === 0) {
                // Fallback: si no existe ruta compilada, retornar completa
                console.warn(`[WARNING] Trip ${tripId}: No simplified route found, using full route`);
                pointsResult = await db.query(`
                    SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp
                    FROM locations 
                    WHERE trip_id = $1 
                    ORDER BY timestamp ASC
                `, [tripId]);
            } else {
                // Transformar el resultado para mantener compatibilidad con frontend
                const row = pointsResult.rows[0];
                // Extraer coordenadas de GeoJSON LineString
                const coordinates = row.geom.coordinates;
                pointsResult.rows = coordinates.map(coord => ({
                    lat: coord[1],
                    lng: coord[0],
                    speed: null,
                    accuracy: null,
                    timestamp: null
                }));
            }
        } else {
            // ❌ SIN OPTIMIZAR: Obtener todos los puntos crudos (~1920)
            // Mantener para compatibilidad hacia atrás
            pointsResult = await db.query(`
                SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp
                FROM locations 
                WHERE trip_id = $1 
                ORDER BY timestamp ASC
            `, [tripId]);
        }

        // 3. Get stops
        const stopsResult = await db.query(`
            SELECT latitude as lat, longitude as lng, start_time, end_time, duration_seconds
            FROM stops 
            WHERE trip_id = $1 
            ORDER BY start_time ASC
        `, [tripId]);

        // Logging para monitoreo
        const pointCount = Array.isArray(pointsResult.rows) ? pointsResult.rows.length : 0;
        console.log(
            `[API] Trip ${tripId}: returned ${pointCount} points ` +
            `(${simplify ? 'simplified ✅' : 'full ❌'})`
        );

        res.json({
            trip: tripResult.rows[0],
            points: pointsResult.rows,
            stops: stopsResult.rows,
            metadata: {
                simplified: simplify,
                point_count: pointCount
            }
        });
    } catch (err) {
        console.error(`[ERROR] Failed to get trip ${tripId}:`, err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
