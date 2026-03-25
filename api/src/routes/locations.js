const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { locationQueue, redis, defaultJobOptions } = require('../services/queue');
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

    // 🔴 1: Log de puntos sin client_id — detecta APK vieja o bug en el cliente
    const missingClientId = points.filter(p => !p.client_id).length;
    if (missingClientId > 0) {
        console.warn(`[DEDUP] ⚠️ emp ${employeeId}: ${missingClientId}/${points.length} points missing client_id — falling back to timestamp dedup`);
    }

    // ── CRÍTICO 2: Ordenar por timestamp antes de cualquier procesamiento ──────
    points.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // ── CRÍTICO 1: Deduplicación por client_id via Redis SET (TTL 24h) ────────
    const seenKey = `seen_points:employee:${employeeId}`;
    const incomingClientIds = points
        .map(p => p.client_id)
        .filter(id => typeof id === 'string' && id.length > 0);

    let duplicateClientIds = new Set();
    if (incomingClientIds.length > 0) {
        try {
            // Pipeline: un solo round-trip para verificar todos los IDs
            const pipeline = redis.pipeline();
            for (const cid of incomingClientIds) {
                pipeline.sismember(seenKey, cid);
            }
            const results = await pipeline.exec();
            results.forEach(([err, isMember], idx) => {
                if (!err && isMember === 1) duplicateClientIds.add(incomingClientIds[idx]);
            });
        } catch (e) {
            console.error('[Redis] Error checking client_ids:', e);
            // Si Redis falla, continuamos sin dedup (mejor que perder datos)
        }
    }

    let inserted = 0;
    let filtered = 0;
    let deduped = 0;
    const filteredPoints = [];
    let lastValidPoint = null;

    // ── CRÍTICO 2: Tracking del último timestamp procesado para detectar out-of-order ──
    const lastTsKey = `last_ts:employee:${employeeId}`;
    let lastProcessedTs = 0;
    try {
        const savedTs = await redis.get(lastTsKey);
        if (savedTs) lastProcessedTs = parseInt(savedTs, 10);
    } catch (e) { /* continuar sin validación de orden */ }

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
        // ── CRÍTICO 1: Rechazar duplicados por client_id ──────────────────────
        if (point.client_id && duplicateClientIds.has(point.client_id)) {
            deduped++;
            continue;
        }

        // ── CRÍTICO 2: Rechazar puntos fuera de orden (>5s antes del último procesado) ──
        if (lastProcessedTs > 0 && point.timestamp < lastProcessedTs - 5000) {
            console.log(`[ORDER] Point discarded: ts=${point.timestamp} < lastTs=${lastProcessedTs} (out-of-order)`);
            filtered++;
            continue;
        }

        // ── CLOCK SKEW: Rechazar puntos con timestamp muy desviado del servidor ──
        // Tolerancia: 5 min hacia el pasado (batches offline legítimos) o 1 min al futuro
        const now = Date.now();
        if (point.timestamp > now + 60000) {
            console.log(`[CLOCK-SKEW] Point from future: ts=${point.timestamp}, now=${now}. Discarding.`);
            filtered++;
            continue;
        }
        // Puntos con >6h de antigüedad son sospechosos (reloj del cliente mal configurado)
        // Los dejamos pasar pero los marcamos como low quality
        if (point.timestamp < now - 6 * 3600 * 1000) {
            console.log(`[CLOCK-SKEW] Very old point: ${Math.round((now - point.timestamp) / 3600000)}h ago. Marking low quality.`);
            point.quality = 'low';
        }

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

        // 🔴 VALIDACIÓN 3: Timestamp — ya validado arriba (clock skew check)

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

                // 🔥 2: Detección de anomalías — teletransportación y GPS falso
                // Teletransportación: salto >50km en <5min (imposible en ciudad)
                if (pointType === 'normal' && distance > 50000) {
                    const timeDiffMin = timeDiffSec / 60;
                    console.warn(`[ANOMALY] 🚨 Teleport detected for emp ${employeeId}: ${(distance/1000).toFixed(1)}km in ${timeDiffMin.toFixed(1)}min`);
                    // Guardar anomalía en Redis para análisis
                    redis.lpush(`anomalies:employee:${employeeId}`, JSON.stringify({
                        type: 'teleport',
                        distance_km: (distance / 1000).toFixed(2),
                        speed_kmh: transitSpeedKmh.toFixed(1),
                        ts: point.timestamp,
                    })).then(() => redis.ltrim(`anomalies:employee:${employeeId}`, 0, 49))
                       .then(() => redis.expire(`anomalies:employee:${employeeId}`, 86400 * 7))
                       .catch(() => {});
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
        `[FLOW-DIAG] Batch processing finished for emp ${employeeId}: Total:${points.length}, OK:${inserted}, Filtered:${filtered}, Deduped:${deduped}`
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

            // ── CRÍTICO 1: Registrar client_ids procesados para deduplicación futura ──
            const processedClientIds = filteredPoints
                .map(p => p.client_id)
                .filter(id => typeof id === 'string' && id.length > 0);

            // ── CRÍTICO 2: Actualizar último timestamp procesado ──────────────────
            const maxTs = filteredPoints.reduce((max, p) => Math.max(max, p.timestamp || 0), 0);

            const pipeline = redis.pipeline();
            pipeline.set(filterKey, JSON.stringify(locationFilter.serialize()), 'EX', 86400);
            pipeline.set(lastPointKey, JSON.stringify({
                lat: last.lat,
                lng: last.lng,
                timestamp: last.timestamp,
                speed: last.speed,
                state: last.state
            }), 'EX', 86400);
            pipeline.set(lastStateKey, last.state || 'WALKING', 'EX', 86400);
            if (maxTs > 0) pipeline.set(lastTsKey, maxTs.toString(), 'EX', 86400);
            if (processedClientIds.length > 0) {
                pipeline.sadd(seenKey, ...processedClientIds);
                pipeline.expire(seenKey, 86400); // TTL 24h
            }

            // Guardar heartbeat_meta si el último punto es un heartbeat
            const lastFiltered = filteredPoints[filteredPoints.length - 1];
            if (lastFiltered?.point_type === 'heartbeat' && lastFiltered?.heartbeat_meta) {
                pipeline.set(
                    `heartbeat_meta:employee:${employeeId}`,
                    JSON.stringify(lastFiltered.heartbeat_meta),
                    'EX', 300 // TTL 5min — si no llega otro heartbeat en 5min, se considera stale
                );
            }

            await pipeline.exec();
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
            // 🟢 3: Prioridad por tipo — recovery/manual > normal
            // BullMQ: prioridad 1 = más alta, mayor número = más baja
            const hasRecovery = pointsForHistory.some(p => p.point_type === 'recovery' || p.point_type === 'manual');
            const jobPriority = hasRecovery ? 1 : 10;

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
                    confidence: p.confidence || 1.0,
                    point_type: p.point_type || 'normal',
                    source: p.source || 'gps',
                    battery: p.battery || null,
                    is_charging: p.is_charging || false,
                    client_id: p.client_id || null,
                }))
            }, { ...defaultJobOptions, priority: jobPriority });
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
            deduped: deduped,
            message: `${inserted} valid points queued for processing`
        });

        // MEDIO 3: Guardar métricas por empleado en Redis (TTL 24h)
        try {
            const metricsKey = `metrics:employee:${employeeId}`;
            const existing = await redis.get(metricsKey);
            const prev = existing ? JSON.parse(existing) : { total_received: 0, total_inserted: 0, total_filtered: 0, total_deduped: 0, batches: 0 };
            await redis.set(metricsKey, JSON.stringify({
                total_received:  prev.total_received  + points.length,
                total_inserted:  prev.total_inserted  + inserted,
                total_filtered:  prev.total_filtered  + filtered,
                total_deduped:   prev.total_deduped   + deduped,
                batches:         prev.batches         + 1,
                last_batch_ts:   Date.now(),
            }), 'EX', 86400);
        } catch (_) { /* métricas no críticas */ }
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

/// ============================================================================
/// ENDPOINT: GET /metrics - Métricas de procesamiento GPS por empleado
/// ============================================================================
router.get('/metrics/:employeeId', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { employeeId } = req.params;
    try {
        const metricsKey = `metrics:employee:${employeeId}`;
        const raw = await redis.get(metricsKey);
        if (!raw) return res.json({ employeeId, message: 'No metrics yet' });
        res.json({ employeeId, ...JSON.parse(raw) });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});

/// ============================================================================
/// ENDPOINT: GET /live-stops - Paradas activas en tiempo real (desde Redis)
/// ============================================================================
router.get('/live-stops', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    try {
        const employees = await db.query(`SELECT id FROM employees WHERE role = 'employee'`);
        const stops = [];
        for (const emp of employees.rows) {
            const raw = await redis.get(`stop:employee:${emp.id}`);
            if (raw) {
                const stop = JSON.parse(raw);
                stops.push(stop);
            }
        }
        res.json(stops);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch live stops' });
    }
});

/// ============================================================================
/// ENDPOINT: GET /queue-stats - Métricas de la cola BullMQ (desde Redis)
/// ============================================================================
router.get('/queue-stats', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    try {
        const raw = await redis.get('queue:stats');
        if (!raw) return res.json({ message: 'No stats yet — worker may not be running', waiting: 0, active: 0, failed: 0, completed: 0, workerStatus: 'no_stats' });
        const stats = JSON.parse(raw);
        const ageSeconds = Math.round((Date.now() - (stats.ts || 0)) / 1000);
        // 🔴 3: Si las métricas tienen >30s de antigüedad, el worker puede estar muerto
        const workerStatus = ageSeconds > 30 ? 'stale' : 'ok';
        res.json({ ...stats, ageSeconds, workerStatus });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch queue stats' });
    }
});

module.exports = router;

/// ============================================================================
/// ENDPOINT: GET /heartbeat-status - Estado de vida de todos los empleados
/// Incluye: razón del estado, último evento significativo, score de calidad
/// ============================================================================
router.get('/heartbeat-status', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const employees = await db.query(`SELECT id, name FROM employees WHERE role = 'employee'`);
        const now = Date.now();
        const statuses = [];

        for (const emp of employees.rows) {
            const [lastPointJson, lastStateJson, metricsJson, heartbeatMetaJson, statusHistoryJson] = await Promise.all([
                redis.get(`last_location:employee:${emp.id}`),
                redis.get(`last_state:employee:${emp.id}`),
                redis.get(`metrics:employee:${emp.id}`),
                redis.get(`heartbeat_meta:employee:${emp.id}`),
                redis.get(`status_history:employee:${emp.id}`),
            ]);

            const lastPoint      = lastPointJson      ? JSON.parse(lastPointJson)      : null;
            const lastState      = lastStateJson      || 'UNKNOWN';
            const metrics        = metricsJson        ? JSON.parse(metricsJson)        : null;
            const heartbeatMeta  = heartbeatMetaJson  ? JSON.parse(heartbeatMetaJson)  : null;
            const statusHistory  = statusHistoryJson  ? JSON.parse(statusHistoryJson)  : [];

            const lastSeenMs  = lastPoint?.timestamp || 0;
            const ageSeconds  = lastSeenMs ? Math.round((now - lastSeenMs) / 1000) : null;

            // ── Clasificación de estado de vida ──────────────────────────────
            let liveStatus = 'unknown';
            if (!lastSeenMs)            liveStatus = 'never_seen';
            else if (ageSeconds < 120)  liveStatus = 'alive';
            else if (ageSeconds < 600)  liveStatus = 'stale';
            else if (ageSeconds < 3600) liveStatus = 'offline';
            else                        liveStatus = 'dead';

            // ── 🟡 1: Razón del estado (debug humano) ────────────────────────
            let reason = heartbeatMeta?.reason || null;
            if (!reason) {
                // Inferir razón si no hay heartbeat_meta
                if (liveStatus === 'never_seen') reason = 'never_connected';
                else if (liveStatus === 'dead')  reason = 'app_closed';
                else if (liveStatus === 'offline' || liveStatus === 'stale') reason = 'no_heartbeat';
            }

            // Etiqueta legible para el admin
            const reasonLabel = {
                no_gps:          'Sin GPS',
                no_network:      'Sin red',
                degraded_mode:   'Modo degradado',
                deep_sleep:      'Modo ahorro',
                battery_saver:   'Batería baja',
                gps_timeout:     'GPS sin señal',
                app_closed:      'App cerrada',
                no_heartbeat:    'Sin heartbeat',
                never_connected: 'Nunca conectado',
            }[reason] || reason || 'Desconocido';

            // ── 🟡 4: Historial de estado (últimas 10 transiciones) ──────────
            // Actualizar historial si el estado cambió
            const lastHistoryEntry = statusHistory[statusHistory.length - 1];
            if (!lastHistoryEntry || lastHistoryEntry.status !== liveStatus) {
                if (lastHistoryEntry) lastHistoryEntry.to = now;
                statusHistory.push({ status: liveStatus, from: now, to: null });
                // Mantener solo las últimas 20 entradas
                if (statusHistory.length > 20) statusHistory.shift();
                redis.set(`status_history:employee:${emp.id}`, JSON.stringify(statusHistory), 'EX', 86400 * 7).catch(() => {});
            }

            // ── 🔥 1: Tracking score (0–100) ────────────────────────────────
            // Basado en: uptime (40%), precisión GPS (30%), frecuencia de sync (30%)
            let trackingScore = 0;
            if (metrics && metrics.batches > 0) {
                // Uptime: qué tan seguido está alive vs total tiempo
                const uptimeFactor = liveStatus === 'alive' ? 1.0 :
                                     liveStatus === 'stale' ? 0.6 :
                                     liveStatus === 'offline' ? 0.2 : 0.0;

                // Precisión: ratio de puntos insertados vs recibidos
                const precisionFactor = metrics.total_received > 0
                    ? Math.min(1, metrics.total_inserted / metrics.total_received)
                    : 0;

                // Frecuencia: batches en las últimas 24h (esperamos ~144 batches/día a 1 cada 10min)
                const expectedBatches = 144;
                const freqFactor = Math.min(1, metrics.batches / expectedBatches);

                trackingScore = Math.round((uptimeFactor * 40) + (precisionFactor * 30) + (freqFactor * 30));
            }

            // ── 🔥 3: Predicción de desconexión ─────────────────────────────
            // Factores: batería baja + señal mala + modo degradado = riesgo alto
            let disconnectionRisk = 'low'; // 'low' | 'medium' | 'high'
            if (heartbeatMeta) {
                const batt = heartbeatMeta.battery_level ?? 100;
                const isDeg = heartbeatMeta.is_degraded ?? false;
                const noGps = heartbeatMeta.is_gps_enabled === false;
                const riskScore = (batt < 15 ? 3 : batt < 30 ? 1 : 0)
                                + (isDeg ? 2 : 0)
                                + (noGps ? 2 : 0)
                                + (liveStatus === 'stale' ? 1 : 0);
                if (riskScore >= 4) disconnectionRisk = 'high';
                else if (riskScore >= 2) disconnectionRisk = 'medium';
            } else if (liveStatus === 'stale' || liveStatus === 'offline') {
                disconnectionRisk = 'medium';
            }

            statuses.push({
                employeeId:   emp.id,
                name:         emp.name,
                liveStatus,
                reason,
                reasonLabel,
                lastState,
                lastSeenMs,
                ageSeconds,
                // 🟡 2: Último evento significativo
                lastGpsTs:    heartbeatMeta?.last_gps_ts    || lastSeenMs,
                lastSyncTs:   heartbeatMeta?.last_sync_ts   || null,
                socketConnected: heartbeatMeta?.socket_connected ?? null,
                isGpsEnabled: heartbeatMeta?.is_gps_enabled ?? null,
                isDegraded:   heartbeatMeta?.is_degraded    ?? false,
                batteryLevel: heartbeatMeta?.battery_level  ?? null,
                // 🟡 4: Historial de estado
                statusHistory: statusHistory.slice(-5), // últimas 5 transiciones
                // 🔥 1: Score de calidad
                trackingScore,
                // 🔥 3: Predicción de desconexión
                disconnectionRisk,
                metrics: metrics ? {
                    total_received: metrics.total_received,
                    total_inserted: metrics.total_inserted,
                    total_filtered: metrics.total_filtered,
                    batches:        metrics.batches,
                    last_batch_ts:  metrics.last_batch_ts,
                } : null,
            });
        }

        res.json(statuses);
    } catch (e) {
        console.error('[heartbeat-status] Error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});
