const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { locationQueue, redis } = require('../services/queue');
const { getIO } = require('../socket/socket');
const db = require('../db/postgres');
const { GPSKalmanEKF } = require('../utils/ekf');
const { detectOngoingStop } = require('../utils/stop_detector');
const http = require('http');

// Helper API gratuita para GeoIP
function fetchGeoIP(ip) {
    return new Promise((resolve) => {
        http.get(`http://ip-api.com/json/${ip}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.status === 'success') resolve(parsed);
                    else resolve(null);
                } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function getCachedGeoIP(ip, redisClient) {
    if (!ip) return null;
    try {
        const cached = await redisClient.get(`geoip:${ip}`);
        if (cached) return JSON.parse(cached);
        const geo = await fetchGeoIP(ip);
        if (geo && geo.lat && geo.lon) {
            await redisClient.set(`geoip:${ip}`, JSON.stringify(geo), 'EX', 3600); // Cachear 1 hora
            return geo;
        }
    } catch(e) { console.error('GeoIP Error:', e); }
    return null;
}

/// ============================================================================
/// CONFIGURACIÓN DE FILTRADO MEJORADO
/// ============================================================================
const ACCURACY_THRESHOLD = 50;      // Metros - rechaza GPS con error > 50m
const DISTANCE_THRESHOLD = 5; // metros para considerar movimiento
const GAP_THRESHOLD_MS = 20 * 60 * 1000; // 20 min unificado
const SPEED_DESK_LIMIT = 200; // km/h
const MAX_SPEED_KMH = 120;       // km/h
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
                e.is_tracking_enabled,
                COALESCE(l.latitude, 0) as lat,
                COALESCE(l.longitude, 0) as lng,
                COALESCE(l.speed, 0) as speed,
                COALESCE(l.accuracy, 99) as accuracy,
                COALESCE(l.timestamp, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000) as timestamp,
                COALESCE(l.created_at, CURRENT_TIMESTAMP) as "lastUpdate",
                COALESCE(l.state, 'OFFLINE') as state,
                COALESCE(l.source, 'unknown') as source,
                (CASE 
                    WHEN (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000 - l.timestamp) > 600000 THEN true 
                    ELSE false 
                END) as is_stale,
                COALESCE(l.confidence, 0.5) as confidence,
                (
                    SELECT COALESCE(AVG(confidence), 1.0)
                    FROM locations loc_sub
                    WHERE loc_sub.employee_id = e.id 
                    AND loc_sub.timestamp > (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000) - 86400000
                ) as reliability_score
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
                e.is_tracking_enabled,
                COALESCE(l.latitude, 0) as lat,
                COALESCE(l.longitude, 0) as lng,
                COALESCE(l.speed, 0) as speed,
                COALESCE(l.accuracy, 99) as accuracy,
                COALESCE(l.timestamp, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000) as timestamp,
                COALESCE(l.created_at, CURRENT_TIMESTAMP) as "lastUpdate",
                COALESCE(l.state, 'OFFLINE') as state,
                COALESCE(l.source, 'unknown') as source,
                (CASE 
                    WHEN (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000 - l.timestamp) > 600000 THEN true 
                    ELSE false 
                END) as is_stale,
                COALESCE(l.confidence, 0.5) as confidence,
                (
                    SELECT COALESCE(AVG(confidence), 1.0)
                    FROM locations loc_sub
                    WHERE loc_sub.employee_id = e.id 
                    AND loc_sub.timestamp > (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT * 1000) - 86400000
                ) as reliability_score
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

    console.log(`[FLOW-DIAG] GPS HIT from emp ${employeeId}: ${Array.isArray(points) ? points.length : 'NOT_ARRAY'} points received`);
    
    if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({ error: 'Valid points array required' });
    }

    let inserted = 0;
    let filtered = 0;
    const filteredPoints = [];
    let lastValidPoint = null;

    // 🧠 EKF — Extended Kalman Filter (persistente por empleado en Redis)
    const filterKey   = `ekf:employee:${employeeId}`;
    const lastPointKey = `last_location:employee:${employeeId}`;
    const lastStateKey = `last_state:employee:${employeeId}`;

    let locationFilter = null; // Se inicializa abajo con el primer punto o estado guardado
    let lastKnownGlobal = null;
    let lastStateInRedis = null;

    try {
        const [savedStateJson, lastPointJson, lastStateJson] = await Promise.all([
            redis.get(filterKey),
            redis.get(lastPointKey),
            redis.get(lastStateKey),
        ]);

        if (savedStateJson) {
            locationFilter = GPSKalmanEKF.deserialize(JSON.parse(savedStateJson));
        } else if (points.length > 0) {
            const p0 = points[0];
            locationFilter = new GPSKalmanEKF(p0.lat, p0.lng, (p0.speed || 0) / 3.6, p0.heading || 0, p0.accuracy || 20);
        } else {
            locationFilter = new GPSKalmanEKF(0, 0, 0, 0, 50);
        }

        if (lastPointJson) lastKnownGlobal = JSON.parse(lastPointJson);
        if (lastStateJson) lastStateInRedis = lastStateJson;
    } catch (e) {
        console.error(`[Redis] Error loading EKF state for ${employeeId}:`, e);
        if (!locationFilter && points.length > 0) {
            const p0 = points[0];
            locationFilter = new GPSKalmanEKF(p0.lat, p0.lng, 0, 0, 50);
        }
    }

    /// ========================================================================
    /// FILTRADO Y SUAVIZADO DE PUNTOS
    /// ========================================================================
    for (const point of points) {
        const accuracy = point.accuracy || 999;
        const state = point.state || 'UNKNOWN';
        const eventType = point.event_type || (state === 'NO_FIX' ? 'NO_FIX' : 'LOCATION');
        const source = point.source || (accuracy < 100 ? 'gps' : 'network');
        const resetReason = point.reset_reason || null;
        const battery = point.battery || null;
        const isCharging = point.is_charging || false;
        
        // 1. Determinar calidad inicial por precisión (AJUSTE AGRESIVO ANTI-RUIDO)
        let quality = 'high';
        if (accuracy > 50) quality = 'low'; // Bajado de 100 a 50 para limpiar el historial
        if (state === 'NO_FIX' || eventType === 'NO_FIX' || state === 'GPS_OFF') quality = 'no_fix';

        // ✅ CÁLCULO DE CONFIDENCE SCORE (0.0 - 1.0)
        let confidence = 1.0;
        if (accuracy > 30) confidence -= 0.2;
        if (accuracy > 60) confidence -= 0.3;
        if (accuracy > 150) confidence -= 0.4;
        if (eventType === 'NO_FIX') confidence -= 0.5;
        if (state === 'GPS_OFF') confidence = 0.0;
        if (source === 'network') confidence -= 0.1;
        if (source === 'mock') confidence = 0.0;
        point.confidence = Math.max(0.0, Math.min(1.0, confidence));

        // 🔴 RECHAZO: Ruido extremo (>500m)
        if (quality !== 'no_fix' && accuracy > 500) {
            console.log(`[FILTER] Point REJECTED: accuracy=${accuracy}m (Extreme noise)`);
            filtered++;
            continue;
        }

        // ✅ FALLBACK: TRIANGULACIÓN POR IP (GEOIP) SOLO SI ES MANUAL Y NO HAY GPS
        if ((state === 'GPS_OFF' || eventType === 'NO_FIX') && point.is_manual_request === true) {
            let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (clientIp) {
                if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
                // Test locally with dynamic IP:
                if (clientIp === '::1' || clientIp === '127.0.0.1') clientIp = '190.235.0.0'; 
                
                const geo = await getCachedGeoIP(clientIp, redis);
                if (geo && geo.lat && geo.lon) {
                    point.lat = geo.lat;
                    point.lng = geo.lon;
                    point.accuracy = 5000;
                    point.source = 'geoip';
                    quality = 'no_fix';
                    console.log(`[GEOIP] Rastreo por IP (${clientIp}): ${geo.lat}, ${geo.lon}`);
                }
            }
        }

        // 🔴 VALIDACIÓN 2: Coordenadas inválidas
        if (typeof point.lat !== 'number' || typeof point.lng !== 'number' ||
            point.lat < MIN_LAT || point.lat > MAX_LAT ||
            point.lng < MIN_LNG || point.lng > MAX_LNG) {
            filtered++;
            continue;
        }

        // 🔴 VALIDACIÓN 3: Timestamp no puede ser futuro
        const now = Date.now();
        if (point.timestamp > now + 60000) {
            filtered++;
            continue;
        }

        // 🔴 VALIDACIÓN 4: Saltos de Velocidad (Transit Speed)
        const comparisonPoint = lastValidPoint || lastKnownGlobal;
        const pointType = point.point_type || 'normal';
        const isManual = pointType === 'manual';
        const isRecovery = pointType === 'recovery';
        
        if (comparisonPoint) {
            const distance = haversineDistance(
                comparisonPoint.lat, comparisonPoint.lng,
                point.lat, point.lng
            );

            // Evitar duplicados si la distancia es mínima en el mismo lote
            // EXCEPCIÓN: Si el estado cambia (ej. a GPS_OFF) o si es una PETICIÓN MANUAL, dejar pasar
            const isStateChange = lastStateInRedis && lastStateInRedis !== (point.state || 'WALKING');

            // 🧠 DEDUPLICACIÓN (Paranoia de Ingeniero): 
            // Si es el MISMO punto exacto (<1m) y muy reciente (<5s), ignorar.
            if (lastValidPoint && distance < 1 && (point.timestamp - lastValidPoint.timestamp) < 5000) {
                filtered++;
                continue;
            }

            // Filtro de redundancia normal
            if (lastValidPoint && distance < DISTANCE_THRESHOLD && !isStateChange && pointType === 'normal') {
                filtered++;
                continue;
            }

            const timeDiffSec = (point.timestamp - comparisonPoint.timestamp) / 1000;
            if (timeDiffSec > 0) {
                const transitSpeedKmh = (distance / timeDiffSec) * 3.6;

                // 🚀 Filtro de Velocidad Inteligente
                // Si es recovery, PERMITIMOS el salto porque venimos de un gap largo.
                // Si es normal, descartamos si es > SPEED_DESK_LIMIT (200 km/h).
                if (pointType === 'normal' && transitSpeedKmh > SPEED_DESK_LIMIT) {
                    console.log(`[JUMP-DETECT] 🚀 Velocity Spike! ${transitSpeedKmh.toFixed(1)} km/h. Discarding.`);
                    filtered++;
                    continue;
                }
                
                if (transitSpeedKmh > 150) {
                    quality = 'low';
                }
            }
        }

        // 🧠 SUAVIZADO EKF (Extended Kalman Filter — modela velocidad + heading)
        const speedMs = (point.speed || 0) / 3.6; // km/h → m/s
        const headingDeg = point.heading || 0;
        const ekfResult = locationFilter.update(
            point.lat,
            point.lng,
            speedMs,
            headingDeg,
            point.accuracy || 50,
            point.timestamp
        );

        // Si el EKF rechazó el punto (outlier imposible físicamente), descartarlo
        if (ekfResult.rejected) {
            console.log(`[EKF] Point REJECTED as outlier (physically impossible jump)`);
            filtered++;
            continue;
        }

        // ✅ PUNTO VÁLIDO: Agregar a lista
        const finalPoint = {
            ...point,
            lat: ekfResult.lat,
            lng: ekfResult.lng,
            speed: ekfResult.speed * 3.6, // m/s → km/h para consistencia
            heading: ekfResult.heading,
            quality: quality,
            source: point.source || source,
            battery: battery,
            is_charging: isCharging,
            point_type: pointType
        };

        filteredPoints.push(finalPoint);
        lastValidPoint = {
            lat: finalPoint.lat,
            lng: finalPoint.lng,
            timestamp: finalPoint.timestamp,
            speed: finalPoint.speed || 0,
            state: finalPoint.state // ✅ Guardamos el estado para detectar cambios
        };
        inserted++;
    }

    console.log(
        `[FLOW-DIAG] Batch processing finished for emp ${employeeId}: Total:${points.length}, OK:${inserted}, Filtered:${filtered}`
    );

    // 🛑 DETECCIÓN DE PARADA EN CURSO (tiempo real)
    if (filteredPoints.length >= 3) {
        const recentForStop = filteredPoints.slice(-20).map(p => ({
            lat: p.lat, lng: p.lng, timestamp: p.timestamp
        }));
        const ongoingStop = detectOngoingStop(recentForStop);
        if (ongoingStop) {
            try {
                await redis.set(
                    `stop:employee:${employeeId}`,
                    JSON.stringify({ ...ongoingStop, employeeId }),
                    'EX', 600 // expira en 10 min si no se actualiza
                );
                console.log(`[STOP] Parada detectada para emp ${employeeId}: ${ongoingStop.durationS}s en (${ongoingStop.lat.toFixed(5)}, ${ongoingStop.lng.toFixed(5)})`);
            } catch (e) {
                console.error('[Redis] Error guardando stop state:', e);
            }
        }
    }

    // 💾 GUARDAR ESTADO EN REDIS AL FINAL DEL LOTE
    try {
        if (filteredPoints.length > 0) {
            const last = filteredPoints[filteredPoints.length - 1];
            await Promise.all([
                redis.set(filterKey, JSON.stringify(locationFilter.serialize()), 'EX', 86400),
                redis.set(lastPointKey, JSON.stringify({
                    lat: last.lat,
                    lng: last.lng,
                    timestamp: last.timestamp,
                    speed: last.speed,
                    state: last.state // ✅ Cachear estado
                }), 'EX', 86400),
                redis.set(lastStateKey, last.state || 'WALKING', 'EX', 86400) // Guardar solo el estado
            ]);
        }
    } catch (e) {
        console.error('[Redis] Error saving state:', e);
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
        // ✅ HISTORY PROTECTION: Permitimos GPS_OFF para el LOG de eventos, 
        // pero el worker los ignorará para distancias y rutas por su estado.
        const pointsForHistory = filteredPoints; 

        if (pointsForHistory.length > 0) {
            await locationQueue.add('process-batch', {
                employeeId,
                points: pointsForHistory.map(p => ({
                    lat: p.lat,
                    lng: p.lng,
                    speed: p.speed,
                    accuracy: p.accuracy,
                    timestamp: p.timestamp,
                    state: p.state || 'STOPPED',
                    quality: p.quality || 'high',
                    point_type: p.point_type || 'normal'
                }))
            });
        }

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
            timestamp: lastPoint.gps_timestamp || lastPoint.timestamp, // ✅ Use point's original GPS time if available
            quality: lastPoint.quality,
            confidence: lastPoint.confidence,
            source: lastPoint.source,
            event_type: lastPoint.event_type,
            reset_reason: lastPoint.reset_reason,
            battery: lastPoint.battery, // ✅ Nuevo telemetry
            is_charging: lastPoint.is_charging, // ✅ Nuevo telemetry
            is_manual_request: lastPoint.is_manual_request || false,
            point_type: lastPoint.point_type || 'normal',
            server_time: new Date().toISOString() // Info adicional de pulso
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
