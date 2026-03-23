/**
 * StopDetector — Detección de paradas reales usando clustering espacio-temporal
 *
 * Por qué el umbral de velocidad simple falla:
 * - Un semáforo en rojo dura 30s → no es una parada real
 * - El GPS tiembla ±5m aunque estés quieto → la velocidad calculada nunca es 0
 * - En tráfico lento, la velocidad baja pero no hay parada
 *
 * Solución: DBSCAN simplificado
 * - Agrupa puntos que están cerca en espacio (< 50m) Y en tiempo (consecutivos)
 * - Solo marca parada si el cluster dura > MIN_STOP_DURATION segundos
 * - El centroide del cluster es la posición de la parada (más preciso que el primer punto)
 */

const EARTH_R = 6371000;

// ─── Configuración ────────────────────────────────────────────────────────────
const MIN_STOP_DURATION_S = 120;  // 2 minutos mínimo para ser parada real
const MAX_STOP_RADIUS_M   = 50;   // Radio máximo del cluster de parada
const MIN_POINTS_IN_STOP  = 3;    // Mínimo de puntos GPS para confirmar parada

/** Distancia en metros entre dos coordenadas (Haversine) */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Analiza una secuencia de puntos GPS y detecta paradas reales.
 *
 * @param {Array<{lat, lng, timestamp, speed}>} points  ordenados por timestamp ASC
 * @returns {Array<{lat, lng, startTime, endTime, durationS, pointCount}>}
 */
function detectStops(points) {
  if (!points || points.length < MIN_POINTS_IN_STOP) return [];

  const stops = [];
  let clusterStart = 0;
  let clusterAnchorLat = points[0].lat;
  let clusterAnchorLng = points[0].lng;
  let inCluster = false;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const dist = haversine(clusterAnchorLat, clusterAnchorLng, p.lat, p.lng);

    if (dist <= MAX_STOP_RADIUS_M) {
      // El punto está dentro del radio del cluster
      if (!inCluster) {
        inCluster = true;
        clusterStart = i - 1;
        clusterAnchorLat = points[clusterStart].lat;
        clusterAnchorLng = points[clusterStart].lng;
      }
    } else {
      // El punto salió del radio — evaluar si el cluster anterior era parada real
      if (inCluster) {
        const clusterPoints = points.slice(clusterStart, i);
        const stop = _evaluateCluster(clusterPoints);
        if (stop) stops.push(stop);
      }
      // Reiniciar cluster
      inCluster = false;
      clusterAnchorLat = p.lat;
      clusterAnchorLng = p.lng;
    }
  }

  // Evaluar el último cluster si quedó abierto
  if (inCluster) {
    const clusterPoints = points.slice(clusterStart);
    const stop = _evaluateCluster(clusterPoints);
    if (stop) stops.push(stop);
  }

  return stops;
}

function _evaluateCluster(clusterPoints) {
  if (clusterPoints.length < MIN_POINTS_IN_STOP) return null;

  const startTime = clusterPoints[0].timestamp;
  const endTime   = clusterPoints[clusterPoints.length - 1].timestamp;
  const durationS = (endTime - startTime) / 1000;

  if (durationS < MIN_STOP_DURATION_S) return null;

  // Centroide del cluster (posición más precisa que cualquier punto individual)
  const lat = clusterPoints.reduce((s, p) => s + p.lat, 0) / clusterPoints.length;
  const lng = clusterPoints.reduce((s, p) => s + p.lng, 0) / clusterPoints.length;

  return {
    lat,
    lng,
    startTime: new Date(startTime),
    endTime:   new Date(endTime),
    durationS: Math.round(durationS),
    pointCount: clusterPoints.length,
  };
}

/**
 * Versión incremental: evalúa si el estado actual (buffer de puntos recientes)
 * constituye una parada en curso. Útil para detección en tiempo real.
 *
 * @param {Array<{lat, lng, timestamp}>} recentPoints  últimos N puntos del empleado
 * @returns {{ isStop: boolean, durationS: number, lat: number, lng: number } | null}
 */
function detectOngoingStop(recentPoints) {
  if (!recentPoints || recentPoints.length < MIN_POINTS_IN_STOP) return null;

  const anchor = recentPoints[0];
  const allNear = recentPoints.every(p =>
    haversine(anchor.lat, anchor.lng, p.lat, p.lng) <= MAX_STOP_RADIUS_M
  );

  if (!allNear) return null;

  const durationS = (recentPoints[recentPoints.length - 1].timestamp - anchor.timestamp) / 1000;
  if (durationS < MIN_STOP_DURATION_S) return null;

  const lat = recentPoints.reduce((s, p) => s + p.lat, 0) / recentPoints.length;
  const lng = recentPoints.reduce((s, p) => s + p.lng, 0) / recentPoints.length;

  return { isStop: true, durationS: Math.round(durationS), lat, lng };
}

module.exports = { detectStops, detectOngoingStop, haversine };
