const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

/**
 * VisitDetector Module - HARDENED PRODUCTION EDITION (v2)
 * Maneja el ciclo de visitas con histéresis, estacionamiento real y desambiguación.
 */
class VisitDetector {
  constructor(pool, redis) {
    this.pool = pool;
    this.redis = redis;
    this.DEFAULT_MIN_VISIT_MS = 5 * 60 * 1000;         // 5 min default if not specified
    this.EXIT_TIMEOUT_MS = 3 * 60 * 1000;              // REDUCIDO: 3 min para salir (más ágil)
    this.ENTRY_RADIUS = 50;                            // Radio para fallback (Punto)
    this.EXIT_RADIUS = 70;                             // Radio para fallback (Punto)
    this.AMBIGUITY_THRESHOLD_METERS = 10;              // Distancia entre tiendas para marcar ambigüedad
    this.MIN_MOVEMENT_FOR_HIGH_SCORE = 20;             // 20m de movimiento interno = 100% score de movimiento
    this.MAX_SPEED_KMH = 120;
  }

  /**
   * Procesa el lote para detectar visitas reales evitando falsos positivos.
   */
  async processPoint(employeeId, point) {
    if (!point || point.accuracy > 50 || point.speed > this.MAX_SPEED_KMH) return;

    const { lat, lng, timestamp } = point;

    try {
      // 1. BUSCAR TOP 2 CLIENTES CERCANOS (DETECCIÓN DE AMBIGÜEDAD)
      const nearbyResult = await this.pool.query(`
        SELECT c.id, c.name, c.min_visit_minutes,
               ST_Distance(c.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist_point,
               CASE WHEN c.geofence IS NOT NULL THEN ST_Intersects(c.geofence, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) ELSE FALSE END as is_inside_geofence
        FROM customers c
        INNER JOIN route_customers rc ON c.id = rc.customer_id
        INNER JOIN route_assignments ra ON rc.route_id = ra.route_id
        WHERE ra.employee_id = $3 
          AND ra.date = CURRENT_DATE
          AND ra.status IN ('pending', 'active')
          AND (
            (c.geofence IS NOT NULL AND ST_DWithin(c.geofence, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4))
            OR
            (c.geofence IS NULL AND ST_DWithin(c.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4))
          )
        ORDER BY dist_point ASC
        LIMIT 2
      `, [lng, lat, employeeId, this.EXIT_RADIUS]);

      const candidates = nearbyResult.rows;
      if (candidates.length === 0) {
        await this.handleExits(employeeId, point);
        return;
      }

      const closest = candidates[0];

      // 2. VERIFICACIÓN DE AMBIGÜEDAD (Centro Comercial / Tiendas pegadas)
      if (candidates.length > 1) {
        const gap = candidates[1].dist_point - candidates[0].dist_point;
        if (gap < this.AMBIGUITY_THRESHOLD_METERS) {
          logger.warn(`[#METRICS#] AMBIGUOUS_LOCATION: Emp ${employeeId} between ${candidates[0].name} and ${candidates[1].name}`);
          return;
        }
      }

      // 3. PROCESAR ENTRADA / ESTABILIDAD (Polígono o Radio)
      const isInside = closest.is_inside_geofence || (closest.dist_point <= this.ENTRY_RADIUS);
      if (isInside) {
        await this.handleCandidateEntry(employeeId, closest, point);
      }

      // 4. PROCESAR SALIDAS EXISTENTES
      await this.handleExits(employeeId, point);

    } catch (err) {
      logger.error(`[VisitDetector] Error: ${err.message}`);
      await this.redis.incr('visit:metrics:errors');
    }
  }

  /**
   * Maneja el ciclo de permanencia (2 min) + desplazamiento (<30m).
   */
  async handleCandidateEntry(employeeId, customer, point) {
    const { lat, lng, timestamp } = point;
    const customerId = customer.id;
    const activeKey = `visit:active:${employeeId}:${customerId}`;
    
    if (await this.redis.exists(activeKey)) {
        const data = JSON.parse(await this.redis.get(activeKey));
        data.lastSeen = timestamp;
        
        // Tracking de movimiento interno para score de visita activa
        const lastLat = data.lastLat || data.firstLat;
        const lastLng = data.lastLng || data.firstLng;
        const dist = this.calculateDistance(lat, lng, lastLat, lastLng);
        data.totalDistance = (data.totalDistance || 0) + dist;
        data.lastLat = lat;
        data.lastLng = lng;
        
        await this.redis.set(activeKey, JSON.stringify(data), 'EX', 3600);
        return;
    }

    const candidateKey = `visit:candidate:${employeeId}:${customerId}`;
    const candDataJson = await this.redis.get(candidateKey);
    const minVisitMs = (customer.min_visit_minutes || 5) * 60 * 1000;

    if (candDataJson) {
      const cand = JSON.parse(candDataJson);
      
      // Tracking de movimiento durante fase de candidato
      const dist = this.calculateDistance(lat, lng, cand.lastLat || cand.firstLat, cand.lastLng || cand.firstLng);
      cand.totalDistance = (cand.totalDistance || 0) + dist;
      cand.lastLat = lat;
      cand.lastLng = lng;

      if (timestamp - cand.firstSeen >= minVisitMs) {
        await this.registerEntry(employeeId, customerId, cand);
      } else {
        await this.redis.set(candidateKey, JSON.stringify(cand), 'EX', 600);
      }
    } else {
      await this.redis.set(candidateKey, JSON.stringify({ 
        firstSeen: timestamp, firstLat: lat, firstLng: lng, lastLat: lat, lastLng: lng, totalDistance: 0 
      }), 'EX', 600);
    }
  }

  /**
   * Maneja la lógica de salida definitiva (>70m + 5 min).
   */
  async handleExits(employeeId, point) {
    const { lat, lng, timestamp } = point;
    const activeKeys = await this.redis.keys(`visit:active:${employeeId}:*`);

    for (const key of activeKeys) {
      const customerId = key.split(':').pop();
      const activeData = JSON.parse(await this.redis.get(key));

      // Consultar si sigue dentro del polígono o radio
      const insideRes = await this.pool.query(`
        SELECT c.id,
               ST_Distance(c.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist_point,
               CASE WHEN c.geofence IS NOT NULL THEN ST_Intersects(c.geofence, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) ELSE FALSE END as is_inside_geofence
        FROM customers c WHERE id = $3`, 
        [lng, lat, customerId]
      );
      
      const status = insideRes.rows[0];
      const isInside = status?.is_inside_geofence || (status?.dist_point <= this.EXIT_RADIUS);

      if (!isInside) {
        const exitKey = `visit:exit_candidate:${employeeId}:${customerId}`;
        const exitStart = await this.redis.get(exitKey);

        if (exitStart) {
          if (timestamp - parseInt(exitStart) >= this.EXIT_TIMEOUT_MS) {
            await this.registerExit(employeeId, customerId, activeData, timestamp);
            await this.redis.del(exitKey);
          }
        } else {
          await this.redis.set(exitKey, timestamp, 'EX', 600);
        }
      } else {
        await this.redis.del(`visit:exit_candidate:${employeeId}:${customerId}`);
      }
    }
  }

  async registerEntry(employeeId, customerId, cand) {
    const { firstSeen, totalDistance } = cand;
    try {
      const res = await this.pool.query(`
        INSERT INTO visits (employee_id, customer_id, arrived_at, status, visit_metadata)
        VALUES ($1, $2, to_timestamp($3/1000.0), 'ongoing', $4)
        ON CONFLICT (employee_id, customer_id, (arrived_at::date)) DO NOTHING
        RETURNING id
      `, [employeeId, customerId, firstSeen, JSON.stringify({ 
        initialDistance: totalDistance,
        entry_timestamp: new Date().toISOString()
      })]);

      if (res.rows.length > 0) {
        const visitId = res.rows[0].id;
        await this.redis.set(`visit:active:${employeeId}:${customerId}`, JSON.stringify({
          visitId, arrivedAt: firstSeen, totalDistance, firstLat: cand.firstLat, firstLng: cand.firstLng
        }), 'EX', 86400);
        await this.redis.incr('visit:metrics:detected');
        logger.info(`[VisitDetector] Entry: Emp ${employeeId} at ${customerId} (ID: ${visitId})`);
      }
      await this.redis.del(`visit:candidate:${employeeId}:${customerId}`);
    } catch (e) {
      logger.error(`[VisitDetector] Entry Error: ${e.message}`);
    }
  }

  async registerExit(employeeId, customerId, activeData, leftAt) {
    const { visitId, arrivedAt, totalDistance = 0 } = activeData;
    const durationSec = Math.floor((leftAt - arrivedAt) / 1000);

    try {
      // Fetch customer settings for scoring
      const custRes = await this.pool.query('SELECT min_visit_minutes FROM customers WHERE id = $1', [customerId]);
      const minVisitMin = custRes.rows[0]?.min_visit_minutes || 5;
      const minVisitSec = minVisitMin * 60;

      // SCORING LOGIC
      // 1. Duration Score (0-50): 100% of 50 pts if they reach min_visit_minutes
      const durationScore = Math.min(50, (durationSec / minVisitSec) * 50);
      
      // 2. Movement Score (0-50): 100% of 50 pts if they moved at least 20m while inside
      const movementScore = Math.min(50, (totalDistance / this.MIN_MOVEMENT_FOR_HIGH_SCORE) * 50);
      
      const finalScore = Math.round(durationScore + movementScore);

      await this.pool.query(`
        UPDATE visits SET 
          left_at = to_timestamp($1/1000.0), 
          duration_seconds = $2, 
          status = 'completed',
          visit_score = $3,
          visit_metadata = visit_metadata || $4::jsonb
        WHERE id = $5
      `, [leftAt, durationSec, finalScore, JSON.stringify({ 
        totalDistance, 
        durationScore, 
        movementScore,
        min_visit_minutes: minVisitMin
      }), visitId]);

      await this.redis.del(`visit:active:${employeeId}:${customerId}`);
      await this.redis.incr('visit:metrics:closed');
      logger.info(`[VisitDetector] Exit: ID ${visitId} Score: ${finalScore} (D: ${durationSec}s, M: ${Math.round(totalDistance)}m)`);
    } catch (e) {
      logger.error(`[VisitDetector] Exit Error: ${e.message}`);
    }
  }

  // Haversine simplificado para validación de desplazamiento
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

module.exports = VisitDetector;
