const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { locationQueue, redis } = require('../services/queue');
const { getIO } = require('../socket/socket');
const db = require('../db/postgres');
const { LocationKalmanFilter } = require('../utils/kalman_filter');
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

    // 🧠 APLICAR FILTRO KALMAN (Persistente por empleado en Redis)
    const filterKey = `kalman:employee:${employeeId}`;
    const lastPointKey = `last_location:employee:${employeeId}`;
    const locationFilter = new LocationKalmanFilter(0, 0, 50);

    let lastKnownGlobal = null;

    try {
        const [savedStateJson, lastPointJson] = await Promise.all([
            redis.get(filterKey),
            redis.get(lastPointKey)
        ]);

        if (savedStateJson) {
            locationFilter.setState(JSON.parse(savedStateJson));
        } else if (points.length > 0) {
            locationFilter.reset(points[0].lat, points[0].lng);
        }

        if (lastPointJson) {
            lastKnownGlobal = JSON.parse(lastPointJson);
        }
    } catch (e) {
        console.error(`[Redis] Error loading state for ${employeeId}:`, e);
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
        
        // 1. Determinar calidad inicial por precisión
        let quality = 'high';
        if (accuracy > 100) quality = 'low';
        if (state === 'NO_FIX' || eventType === 'NO_FIX' || state === 'GPS_OFF') quality = 'no_fix';

        // ✅ CÁLCULO DE CONFIDENCE SCORE (0.0 - 1.0)
        let confidence = 1.0;
        if (accuracy > 200) confidence -= 0.3;
        if (accuracy > 500) confidence -= 0.2;
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

        // ✅ FALLBACK: TRIANGULACIÓN POR IP (GEOIP) SI ESTÁN APAGADOS
        if (state === 'GPS_OFF' || eventType === 'NO_FIX') {
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
        if (comparisonPoint) {
            const distance = haversineDistance(
                comparisonPoint.lat, comparisonPoint.lng,
                point.lat, point.lng
            );

            // Evitar duplicados si la distancia es mínima en el mismo lote
            if (lastValidPoint && distance < DISTANCE_THRESHOLD) {
                filtered++;
                continue;
            }

            const timeDiffSec = (point.timestamp - comparisonPoint.timestamp) / 1000;
            if (timeDiffSec > 0) {
                const transitSpeedKmh = (distance / timeDiffSec) * 3.6;

                // Si la velocidad para alcanzar este punto es > 150 km/h, es un SALTO
                if (transitSpeedKmh > 150) {
                    console.log(`[JUMP-DETECT] 🚀 Jump detected! Speed: ${transitSpeedKmh.toFixed(1)} km/h. Marking as LOW.`);
                    quality = 'low';
                    // Si el salto es absurdo (>500km/h), descartar punto
                    if (transitSpeedKmh > 500) {
                        filtered++;
                        continue;
                    }
                }

                // 🔴 VALIDACIÓN 5: Aceleración máxima (solo si hay punto previo en el mismo lote)
                if (lastValidPoint) {
                    const speedDiffKmh = Math.abs((point.speed || 0) - lastValidPoint.speed);
                    const acceleration = speedDiffKmh / timeDiffSec;
                    if (acceleration > 40) { // > 40 km/h/s es irreal incluso para Tesla
                        quality = 'low';
                    }
                }
            }
        }

        // 🧠 SUAVIZADO KALMAN
        const smoothedCoords = locationFilter.update(
            point.lat,
            point.lng,
            point.accuracy || 50,
            point.speed ? point.speed * 3.6 : 0
        );

        // ✅ PUNTO VÁLIDO: Agregar a lista
        const finalPoint = {
            ...point,
            lat: smoothedCoords.lat,
            lng: smoothedCoords.lng,
            quality: quality, // Asignar calidad corregida
            source: point.source || source
        };

        filteredPoints.push(finalPoint);
        lastValidPoint = {
            lat: finalPoint.lat,
            lng: finalPoint.lng,
            timestamp: finalPoint.timestamp,
            speed: finalPoint.speed || 0
        };
        inserted++;
    }

    console.log(
        `[FLOW-DIAG] Batch processing finished for emp ${employeeId}: Total:${points.length}, OK:${inserted}, Filtered:${filtered}`
    );

    // 💾 GUARDAR ESTADO EN REDIS AL FINAL DEL LOTE
    try {
        if (filteredPoints.length > 0) {
            const last = filteredPoints[filteredPoints.length - 1];
            await Promise.all([
                redis.set(filterKey, JSON.stringify(locationFilter.getState()), 'EX', 86400),
                redis.set(lastPointKey, JSON.stringify({
                    lat: last.lat,
                    lng: last.lng,
                    timestamp: last.timestamp,
                    speed: last.speed
                }), 'EX', 86400)
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
        // Push filtered points to processing queue
        await locationQueue.add('process-batch', {
            employeeId,
            points: filteredPoints.map(p => ({
                lat: p.lat,
                lng: p.lng,
                speed: p.speed,
                accuracy: p.accuracy,
                timestamp: p.timestamp,
                state: p.state || 'STOPPED',
                quality: p.quality || 'high' // ✅ NUEVO: Pasar calidad al worker
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
            timestamp: lastPoint.timestamp,
            quality: lastPoint.quality,
            confidence: lastPoint.confidence,
            source: lastPoint.source,
            event_type: lastPoint.event_type,
            reset_reason: lastPoint.reset_reason
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
