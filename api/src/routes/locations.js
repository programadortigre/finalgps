const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { locationQueue } = require('../services/queue');
const { getIO } = require('../socket/socket');
const db = require('../db/postgres');

/// ============================================================================
/// CONFIGURACIÓN DE FILTRADO
/// ============================================================================
const ACCURACY_THRESHOLD = 50;  // Metros - rechaza GPS con error > 50m
const DISTANCE_THRESHOLD = 10;  // Metros - agrupa puntos < 10m
const MAX_LAT = 90;
const MIN_LAT = -90;
const MAX_LNG = 180;
const MIN_LNG = -180;

/// ============================================================================
/// ENDPOINT: GET / - Obtener últimas ubicaciones de todos los empleados
/// ============================================================================
router.get('/', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        // Query para obtener el registro más reciente por cada employee_id
        const result = await db.query(`
            SELECT DISTINCT ON (e.id)
                e.id as "employeeId",
                e.name,
                l.latitude as lat,
                l.longitude as lng,
                l.speed,
                l.accuracy,
                l.timestamp,
                l.created_at as "lastUpdate"
            FROM employees e
            INNER JOIN locations l ON e.id = l.employee_id
            WHERE e.role = 'employee'
            ORDER BY e.id, l.timestamp DESC
        `);

        res.json(result.rows);
    } catch (err) {
        console.error('[ERROR] Failed to fetch latest locations:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/// ============================================================================
/// FUNCIÓN AUXILIAR: Calcular distancia entre dos puntos (Haversine)
/// ============================================================================
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Radio terrestre en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/// ============================================================================
/// ENDPOINT: POST /batch - Recibir puntos GPS con FILTRADO
/// ============================================================================
router.post('/batch', auth, async (req, res) => {
    const { points } = req.body;
    const employeeId = req.user.id;

    if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({ error: 'Valid points array required' });
    }

    let inserted = 0;
    let filtered = 0;
    const filteredPoints = [];
    let lastValidPoint = null;

    /// ========================================================================
    /// FILTRADO DE PUNTOS
    /// ========================================================================
    for (const point of points) {
        // 🔴 VALIDACIÓN 1: Accuracy > 50m → RECHAZAR (GPS ruido)
        if (point.accuracy !== undefined && point.accuracy > ACCURACY_THRESHOLD) {
            console.log(
                `[FILTER] Point rejected: accuracy=${point.accuracy}m > ${ACCURACY_THRESHOLD}m`
            );
            filtered++;
            continue;
        }

        // 🔴 VALIDACIÓN 2: Coordenadas inválidas
        if (
            typeof point.lat !== 'number' || typeof point.lng !== 'number' ||
            point.lat < MIN_LAT || point.lat > MAX_LAT ||
            point.lng < MIN_LNG || point.lng > MAX_LNG
        ) {
            console.log(
                `[FILTER] Point rejected: invalid coordinates lat=${point.lat}, lng=${point.lng}`
            );
            filtered++;
            continue;
        }

        // 🔴 VALIDACIÓN 3: Timestamp no puede ser futuro
        const now = Date.now();
        if (point.timestamp > now + 60000) {  // Permite 1 min de diferencia horaria
            console.log(
                `[FILTER] Point rejected: timestamp in future`
            );
            filtered++;
            continue;
        }

        // 🔴 VALIDACIÓN 4: Distance clustering < 10m → IGNORAR DUPLICADO
        if (lastValidPoint !== null) {
            const distance = haversineDistance(
                lastValidPoint.lat, lastValidPoint.lng,
                point.lat, point.lng
            );
            if (distance < DISTANCE_THRESHOLD) {
                console.log(
                    `[FILTER] Point ignored: distance=${distance.toFixed(1)}m < ${DISTANCE_THRESHOLD}m (duplicate)`
                );
                filtered++;
                continue;
            }
        }

        // ✅ PUNTO VÁLIDO: Agregar a lista
        filteredPoints.push(point);
        lastValidPoint = point;
        inserted++;
    }

    console.log(
        `[BATCH] Received ${points.length} points: ${inserted} inserted, ${filtered} filtered`
    );

    if (filteredPoints.length === 0) {
        // Todos los puntos fueron filtrados
        return res.status(202).json({
            status: 'queued',
            inserted: 0,
            filtered: filtered,
            message: 'All points were filtered out (GPS noise or duplicates)'
        });
    }

    try {
        // Push filtered points to processing queue
        await locationQueue.add('process-batch', {
            employeeId,
            points: filteredPoints
        });

        // Real-time update for admins (solo último punto válido)
        const io = getIO();
        if (io) {
            const lastPoint = filteredPoints[filteredPoints.length - 1];
            io.to('admins').emit('location_update', {
                employeeId,
                name: req.user.name,
                lat: lastPoint.lat,
                lng: lastPoint.lng,
                timestamp: lastPoint.timestamp
            });
        }

        res.status(202).json({
            status: 'queued',
            inserted: inserted,
            filtered: filtered,
            message: `${inserted} valid points queued for processing`
        });
    } catch (err) {
        console.error('[ERROR] Failed to queue locations:', err);
        res.status(500).json({ error: 'Failed to queue locations' });
    }
});

module.exports = router;
