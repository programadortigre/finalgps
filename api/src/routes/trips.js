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
        let isSimplified = false;
        
        if (simplify) {
            // ✅ OPTIMIZADO: Usar ruta simplificada de trip_routes
            // (~120 puntos en lugar de 1920 = 88% reducción en tamaño)
            try {
                pointsResult = await db.query(`
                    SELECT 
                        ST_AsGeoJSON(geom_simplified)::json as geom,
                        point_count_simplified as point_count,
                        TRUE as is_simplified
                    FROM trip_routes
                    WHERE trip_id = $1
                `, [tripId]);
            } catch (tableError) {
                // Si la tabla no existe, pasar al fallback directo
                if (tableError.message.includes('trip_routes') || tableError.message.includes('does not exist')) {
                    console.warn(`[WARNING] Trip ${tripId}: trip_routes table does not exist, using full route fallback`);
                    pointsResult = { rows: [] };
                } else {
                    throw tableError; // Re-throw otros errores
                }
            }

            if (pointsResult.rows.length === 0) {
                // Fallback: si no existe ruta compilada, retornar completa
                console.warn(`[WARNING] Trip ${tripId}: No simplified route found, using full route`);
                pointsResult = await db.query(`
                    SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp
                    FROM locations 
                    WHERE trip_id = $1 
                    ORDER BY timestamp ASC
                `, [tripId]);
                isSimplified = false;
            } else {
                try {
                    // Transformar el resultado para mantener compatibilidad con frontend
                    const row = pointsResult.rows[0];
                    
                    // Validar que geom es un objeto válido con coordinates
                    if (row.geom && row.geom.coordinates && Array.isArray(row.geom.coordinates)) {
                        // Extraer coordenadas de GeoJSON LineString
                        const coordinates = row.geom.coordinates;
                        pointsResult.rows = coordinates.map(coord => ({
                            lat: coord[1],
                            lng: coord[0],
                            speed: null,
                            accuracy: null,
                            timestamp: null
                        }));
                        isSimplified = true;
                    } else {
                        // Si el GeoJSON no es válido, hacer fallback a ruta completa
                        console.warn(`[WARNING] Trip ${tripId}: Invalid GeoJSON structure in trip_routes, using full route`);
                        pointsResult = await db.query(`
                            SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp
                            FROM locations 
                            WHERE trip_id = $1 
                            ORDER BY timestamp ASC
                        `, [tripId]);
                        isSimplified = false;
                    }
                } catch (geoJsonError) {
                    // Si hay error procesando GeoJSON, hacer fallback
                    console.warn(`[WARNING] Trip ${tripId}: Error processing GeoJSON - ${geoJsonError.message}, using full route`);
                    pointsResult = await db.query(`
                        SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp
                        FROM locations 
                        WHERE trip_id = $1 
                        ORDER BY timestamp ASC
                    `, [tripId]);
                    isSimplified = false;
                }
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
            `(${isSimplified ? 'simplified ✅' : 'full ❌'})`
        );

        res.json({
            trip: tripResult.rows[0],
            points: pointsResult.rows,
            stops: stopsResult.rows,
            metadata: {
                simplified: isSimplified,
                point_count: pointCount
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
