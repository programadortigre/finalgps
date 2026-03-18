const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { locationQueue, redis } = require('../services/queue');
const { getIO } = require('../socket/socket');
const db = require('../db/postgres');
const { LocationKalmanFilter } = require('../utils/kalman_filter');

/// ============================================================================
/// CONFIGURACIÓN DE FILTRADO MEJORADO
/// ============================================================================
const ACCURACY_THRESHOLD = 50;      // Metros - rechaza GPS con error > 50m
const DISTANCE_THRESHOLD = 4;    // Metros (Aumentado de 2 a 4 para evitar jitter)
const MAX_SPEED_KMH = 120;       // km/h (Bajado de 180 para filtrar saltos urbanos)
const MAX_ACCELERATION = 50;     // m/s²
const ACTIVE_THRESHOLD = 15;     // Minutos (Aumentado de 5 a 15 para evitar parpadeo)
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
        // Cambio crítico: LEFT JOIN (no INNER) para devolver empleados aunque sin ubicaciones recientes
        const result = await db.query(`
            SELECT DISTINCT ON (e.id)
                e.id as "employeeId",
                e.name,
                COALESCE(l.latitude, 0) as lat,
                COALESCE(l.longitude, 0) as lng,
                COALESCE(l.speed, 0) as speed,
                COALESCE(l.accuracy, 99) as accuracy,
                COALESCE(l.timestamp, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000) as timestamp,
                COALESCE(l.created_at, CURRENT_TIMESTAMP) as "lastUpdate",
                COALESCE(l.state, 'OFFLINE') as state
            FROM employees e
            LEFT JOIN locations l ON e.id = l.employee_id
            WHERE e.role = 'employee'
            ORDER BY e.id, l.timestamp DESC NULLS LAST
        `);

        res.json(result.rows);
    } catch (err) {
        console.error('[ERROR] Failed to fetch latest locations:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/// ============================================================================
/// ENDPOINT: GET /active - Obtener solo empleados ACTIVOS (últimas 5 minutos)
/// ============================================================================
router.get('/active', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        // Solo empleados que hayan enviado ubicación en los últimos 5 minutos
        const result = await db.query(`
            SELECT DISTINCT ON (e.id)
                e.id as "employeeId",
                e.name,
                COALESCE(l.latitude, 0) as lat,
                COALESCE(l.longitude, 0) as lng,
                COALESCE(l.speed, 0) as speed,
                COALESCE(l.accuracy, 99) as accuracy,
                COALESCE(l.timestamp, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000) as timestamp,
                COALESCE(l.created_at, CURRENT_TIMESTAMP) as "lastUpdate",
                COALESCE(l.state, 'OFFLINE') as state
            FROM employees e
            INNER JOIN locations l ON e.id = l.employee_id
            WHERE e.role = 'employee' 
                AND l.timestamp > (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000) - (5 * 60 * 1000)
            ORDER BY e.id, l.timestamp DESC
        `);

        res.json(result.rows);
    } catch (err) {
        console.error('[ERROR] Failed to fetch active locations:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/// ============================================================================
/// FUNCIÓN AUXILIAR: Calcular distancia entre dos puntos (Haversine)
/// ============================================================================
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radio terrestre en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/// ============================================================================
/// ENDPOINT: POST /batch - Recibir puntos GPS con FILTRADO + KALMAN
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

    // 🧠 APLICAR FILTRO KALMAN (Persistente por empleado en Redis)
    const filterKey = `kalman:employee:${employeeId}`;
    const locationFilter = new LocationKalmanFilter(0, 0, 50); // Valores dummy iniciales

    try {
        const savedStateJson = await redis.get(filterKey);
        if (savedStateJson) {
            locationFilter.setState(JSON.parse(savedStateJson));
        } else if (points.length > 0) {
            // Inicializar con el primer punto si no hay estado previo
            locationFilter.reset(points[0].lat, points[0].lng);
        }
    } catch (e) {
        console.error(`[Redis] Error loading kalman state for ${employeeId}:`, e);
    }

    /// ========================================================================
    /// FILTRADO Y SUAVIZADO DE PUNTOS
    /// ========================================================================
    for (const point of points) {
        // Log detallado de cada punto recibido para depuración
        console.log(`[BATCH][DETAIL] emp:${employeeId} lat:${point.lat} lng:${point.lng} acc:${point.accuracy} ts:${point.timestamp} speed:${point.speed}`);
        // ✅ FILTRO INTELIGENTE: Marcar calidad, no descartar
        if (point.accuracy !== undefined) {
            if (point.accuracy > 80) {
                point.quality = "low";
            } else if (point.accuracy > 50) {
                point.quality = "medium";
            } else {
                point.quality = "high";
            }
        } else {
            point.quality = "unknown";
        }
        // Guardar todos los puntos, pero loguear si la calidad es baja
        if (point.accuracy !== undefined && point.accuracy > 150) {
            console.log(`[FILTER] Point REJECTED: accuracy=${point.accuracy}m (Too low quality)`);
            filtered++;
            continue;
        }

        if (point.quality === "low") {
            console.log(
                `[FILTER] Point marked as LOW quality: accuracy=${point.accuracy}m`
            );
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

            // 🔴 VALIDACIÓN 5: Velocidad máxima (validación inteligente)
            const timeDiffSec = (point.timestamp - lastValidPoint.timestamp) / 1000;
            if (timeDiffSec > 0) {
                const calculatedSpeedKmh = (distance / timeDiffSec) * 3.6;

                // Rechazar si la velocidad calculada es irreal (> 180 km/h)
                if (calculatedSpeedKmh > MAX_SPEED_KMH) {
                    console.log(
                        `[FILTER] Point rejected: speed=${calculatedSpeedKmh.toFixed(1)} km/h > ${MAX_SPEED_KMH} km/h`
                    );
                    filtered++;
                    continue;
                }

                // 🔴 VALIDACIÓN 6: Aceleración máxima realista
                const speedDiffKmh = Math.abs((point.speed || 0) - lastValidPoint.speed);
                if (speedDiffKmh > MAX_ACCELERATION && timeDiffSec > 0) {
                    const acceleration = speedDiffKmh / timeDiffSec;
                    // The provided code snippet was syntactically incorrect for JavaScript.
                    // Assuming the intent was to modify the existing acceleration check,
                    // but without a clear, syntactically valid replacement,
                    // the original check is retained to ensure the file remains valid.
                    // If a specific change to the acceleration logic is desired,
                    // please provide a syntactically correct JavaScript code block.
                    if (acceleration > 20) { // > 20 km/h/s es irreal
                        console.log(
                            `[FILTER] Point rejected: acceleration=${acceleration.toFixed(1)} km/h/s (too high)`
                        );
                        filtered++;
                        continue;
                    }
                }
            }
        }

        const smoothedCoords = locationFilter.update(
            point.lat,
            point.lng,
            point.accuracy || 50
        );

        // ✅ PUNTO VÁLIDO: Agregar a lista con coordenadas suavizadas
        const smoothedPoint = {
            ...point,
            lat: smoothedCoords.lat,
            lng: smoothedCoords.lng,
        };

        filteredPoints.push(smoothedPoint);
        lastValidPoint = {
            ...point,
            lat: smoothedCoords.lat,
            lng: smoothedCoords.lng,
        };
        inserted++;
    }

    console.log(
        `[BATCH] Received ${points.length} points: ${inserted} inserted, ${filtered} filtered`
    );

    // Guardar estado actualizado en Redis (expira en 12 horas si no hay movimiento)
    try {
        await redis.setex(filterKey, 43200, JSON.stringify(locationFilter.getState()));
    } catch (e) {
        console.error(`[Redis] Error saving kalman state for ${employeeId}:`, e);
    }

    if (filteredPoints.length === 0) {
        // Solo marcar como OFFLINE si no hay datos en absoluto
        // Si hay puntos pero todos son de baja calidad, igual se consideran "online" pero con baja calidad
        return res.status(202).json({
            status: 'queued',
            inserted: 0,
            filtered: filtered,
            message: 'No data points received (completamente offline o sin datos)'
        });
    }

    try {
        // Push filtered points to processing queue
        await locationQueue.add('process-batch', {
            employeeId,
            points: filteredPoints.map(p => ({
                lat: p.lat,
                lng: p.lng,
                speed: p.speed,
                accuracy: p.accuracy,
                timestamp: p.timestamp,
                state: p.state || 'STOPPED'
            }))
        });

        // Real-time update for admins (solo último punto válido)
        // ✅ USAR REDIS PUB/SUB para escalabilidad cross-instance
        const lastPoint = filteredPoints[filteredPoints.length - 1];
        const updateData = {
            employeeId,
            name: req.user.name,
            lat: lastPoint.lat,
            lng: lastPoint.lng,
            speed: lastPoint.speed,
            accuracy: lastPoint.accuracy,
            state: lastPoint.state || 'STOPPED',
            timestamp: lastPoint.timestamp
        };

        try {
            await redis.publish('location_updates', JSON.stringify(updateData));
        } catch (err) {
            console.error('[Redis] Failed to publish location update:', err);
            // Fallback al socket local si redis falla
            const io = getIO();
            if (io) io.to('admins').emit('location_update', updateData);
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

/// ============================================================================
/// ENDPOINT: POST /status - Actualizar estado explícito (ej. OFFLINE)
/// ============================================================================
router.post('/status', auth, async (req, res) => {
    const { state } = req.body;
    const employeeId = req.user.id;

    if (!state) {
        return res.status(400).json({ error: 'Status is required' });
    }

    try {
        // Enviar actualización en tiempo real al panel de admin
        const io = getIO();
        if (io) {
            // Obtenemos último registro para tener coords válidas aunque cambie solo el estado
            const lastLoc = await db.query(`
                SELECT latitude as lat, longitude as lng, speed, accuracy
                FROM locations 
                WHERE employee_id = $1 
                ORDER BY timestamp DESC LIMIT 1
            `, [employeeId]);

            let updateData = {
                employeeId,
                name: req.user.name,
                state,
                timestamp: Date.now()
            };

            if (lastLoc.rows.length > 0) {
                updateData = { ...updateData, ...lastLoc.rows[0] };
            }

            try {
                await redis.publish('location_updates', JSON.stringify(updateData));
            } catch (err) {
                console.error('[Redis] Failed to publish status update:', err);
                io.to('admins').emit('location_update', updateData);
            }
        }

        // Actualizar base de datos para cerrar el viaje si es OFFLINE
        if (state === 'OFFLINE') {
            await db.query(`
                UPDATE trips SET is_active = FALSE, end_time = NOW() 
                WHERE employee_id = $1 AND is_active = TRUE
            `, [employeeId]);
            console.log(`[STATUS] Trip closed for employee ${employeeId} due to OFFLINE status`);
        }

        res.json({ success: true, message: `Status updated to ${state}` });
    } catch (err) {
        console.error('[ERROR] Failed to update status:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
