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
    this.STABILITY_THRESHOLD_MS = 2 * 60 * 1000;      // 2 min para entrar
    this.EXIT_TIMEOUT_MS = 5 * 60 * 1000;             // 5 min para salir
    this.ENTRY_RADIUS = 50;                           // Radio de entrada
    this.EXIT_RADIUS = 70;                            // Radio de salida
    this.AMBIGUITY_THRESHOLD_METERS = 10;             // Distancia entre tiendas para marcar ambigüedad
    this.MAX_STATIONARY_DISPLACEMENT_METERS = 30;     // Desplazamiento máx durante los 2 min
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
        SELECT c.id, c.name, 
               ST_Distance(c.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist
        FROM customers c
        INNER JOIN route_customers rc ON c.id = rc.customer_id
        INNER JOIN route_assignments ra ON rc.route_id = ra.route_id
        WHERE ra.employee_id = $3 
          AND ra.date = CURRENT_DATE
          AND ra.status IN ('pending', 'active')
          AND ST_DWithin(c.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
        ORDER BY dist ASC
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
        const gap = candidates[1].dist - candidates[0].dist;
        if (gap < this.AMBIGUITY_THRESHOLD_METERS) {
          logger.warn(`[#METRICS#] AMBIGUOUS_LOCATION: Emp ${employeeId} between ${candidates[0].name} and ${candidates[1].name}`);
          return; // No iniciamos visita si hay duda (evita rebote entre tiendas)
        }
      }

      // 3. PROCESAR ENTRADA / ESTABILIDAD
      if (closest.dist <= this.ENTRY_RADIUS) {
        await this.handleCandidateEntry(employeeId, closest.id, point);
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
  async handleCandidateEntry(employeeId, customerId, point) {
    const { lat, lng, timestamp } = point;
    const activeKey = `visit:active:${employeeId}:${customerId}`;
    if (await this.redis.exists(activeKey)) {
        // Ya está activa, actualizamos lastSeen
        const data = JSON.parse(await this.redis.get(activeKey));
        data.lastSeen = timestamp;
        await this.redis.set(activeKey, JSON.stringify(data), 'EX', 3600);
        return;
    }

    const candidateKey = `visit:candidate:${employeeId}:${customerId}`;
    const candDataJson = await this.redis.get(candidateKey);

    if (candDataJson) {
      const cand = JSON.parse(candDataJson);
      
      // FILTRO: Estacionamiento real (Desplazamiento)
      const displacement = this.calculateDistance(lat, lng, cand.firstLat, cand.firstLng);
      if (displacement > this.MAX_STATIONARY_DISPLACEMENT_METERS) {
        // Se movió demasiado, resetear candidato (no está parado visitando)
        await this.redis.set(candidateKey, JSON.stringify({ firstSeen: timestamp, firstLat: lat, firstLng: lng }), 'EX', 600);
        return;
      }

      if (timestamp - cand.firstSeen >= this.STABILITY_THRESHOLD_MS) {
        await this.registerEntry(employeeId, customerId, cand.firstSeen, timestamp);
      }
    } else {
      // Nuevo candidato
      await this.redis.set(candidateKey, JSON.stringify({ 
        firstSeen: timestamp, firstLat: lat, firstLng: lng 
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

      // Consultar distancia actual al cliente de la visita activa
      const distRes = await this.pool.query(
        `SELECT ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist FROM customers WHERE id = $3`,
        [lng, lat, customerId]
      );
      const dist = distRes.rows[0]?.dist || 999;

      if (dist > this.EXIT_RADIUS) {
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

  async registerEntry(employeeId, customerId, arrivedAt, lastSeen) {
    try {
      const res = await this.pool.query(`
        INSERT INTO visits (employee_id, customer_id, arrived_at, status)
        VALUES ($1, $2, to_timestamp($3/1000.0), 'ongoing')
        ON CONFLICT (employee_id, customer_id, (arrived_at::date)) DO NOTHING
        RETURNING id
      `, [employeeId, customerId, arrivedAt]);

      if (res.rows.length > 0) {
        const visitId = res.rows[0].id;
        await this.redis.set(`visit:active:${employeeId}:${customerId}`, JSON.stringify({
          visitId, arrivedAt, lastSeen
        }), 'EX', 86400);
        await this.redis.incr('visit:metrics:detected');
        logger.info(`[#METRICS#] VISIT_DETECTED: Emp ${employeeId} at ${customerId}`);
      }
      await this.redis.del(`visit:candidate:${employeeId}:${customerId}`);
    } catch (e) {
      logger.error(`[VisitDetector] Entry Error: ${e.message}`);
    }
  }

  async registerExit(employeeId, customerId, activeData, leftAt) {
    const { visitId, arrivedAt } = activeData;
    const duration = Math.floor((leftAt - arrivedAt) / 1000);

    try {
      await this.pool.query(`
        UPDATE visits SET left_at = to_timestamp($1/1000.0), duration_seconds = $2, status = 'completed'
        WHERE id = $3
      `, [leftAt, duration, visitId]);

      await this.redis.del(`visit:active:${employeeId}:${customerId}`);
      await this.redis.incr('visit:metrics:closed');
      logger.info(`[#METRICS#] VISIT_CLOSED: ID ${visitId} (${duration}s)`);
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
