/**
 * useSmartTracking — Ver vendedores en vivo en el panel admin
 *
 * Cómo funciona:
 * 1. Polling HTTP cada 5s → fuente de verdad (funciona aunque el socket caiga)
 * 2. Socket → fast-path: actualiza la posición al instante cuando llega un punto
 * 3. Interpolación suave: entre dos puntos reales, el marcador se mueve gradualmente
 *    en lugar de saltar. Solo aplica a vendedores en movimiento (DRIVING / WALKING).
 * 4. Heartbeat status: cada 30s consulta /heartbeat-status para detectar
 *    empleados silenciosos (alive / stale / offline / dead / degraded).
 *
 * Resultado: marcadores siempre actualizados, nunca congelados.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { socket } from '../services/socket';
import dayjs from 'dayjs';

const POLL_MS            = 5000;   // Polling HTTP cada 5s
const INTERP_MS          = 250;    // Tick de animación (4 fps)
const MAX_INTERP_MS      = 15000;  // Dejar de interpolar si el punto tiene >15s de antigüedad
const HEARTBEAT_POLL_MS  = 30000;  // Consultar heartbeat-status cada 30s
// Queue stats: adaptativo — 10s si hay jobs pendientes, 45s si cola vacía

// Estados que implican movimiento real
const MOVING_STATES = new Set([
  'DRIVING', 'WALKING', 'BATT_SAVER',
  'En auto', 'A pie', 'Lento',
]);

// ─── Interpolación lineal entre dos puntos ────────────────────────────────────
function lerp(prev, next, nowMs) {
  const duration = next.receivedAt - prev.receivedAt;
  if (duration <= 0) return { lat: next.lat, lng: next.lng };
  const t = Math.min(1, (nowMs - prev.receivedAt) / duration);
  return {
    lat: prev.lat + (next.lat - prev.lat) * t,
    lng: prev.lng + (next.lng - prev.lng) * t,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSmartTracking() {
  // rawLocations: datos reales del servidor, nunca se renderizan directamente
  const raw = useRef({});
  // trail: últimos 50 puntos por vendedor para dibujar el recorrido en vivo
  const trails = useRef({});

  const [locations, setLocations]         = useState({});
  const [liveActiveIds, setLiveActiveIds] = useState(new Set());
  const [isConnected, setIsConnected]     = useState(true);
  const [liveTrails, setLiveTrails]       = useState({});
  const [liveStops, setLiveStops]         = useState([]); // paradas activas en tiempo real
  // heartbeatStatus: { [employeeId]: 'alive' | 'stale' | 'offline' | 'dead' | 'unknown' }
  const [heartbeatStatus, setHeartbeatStatus] = useState({});
  // queueStats: { waiting, active, failed, completed, ageSeconds, workerStatus, jobsPerSec }
  const [queueStats, setQueueStats] = useState(null);

  const mounted = useRef(true);

  // ── 1. Polling HTTP ──────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const [allRes, activeRes] = await Promise.all([
        api.get('/api/locations'),
        api.get('/api/locations/active'),
      ]);
      if (!mounted.current) return;

      const nowMs = Date.now();

      allRes.data.forEach((loc) => {
        const prev = raw.current[loc.employeeId];
        raw.current[loc.employeeId] = {
          ...loc,
          _prevLat:        prev?.lat        ?? loc.lat,
          _prevLng:        prev?.lng        ?? loc.lng,
          _prevReceivedAt: prev?.receivedAt ?? nowMs - POLL_MS,
          receivedAt:      nowMs,
        };
      });

      setLiveActiveIds(new Set(activeRes.data.map((l) => l.employeeId)));
      setIsConnected(true);
    } catch {
      if (mounted.current) setIsConnected(false);
    }
  }, []);

  // ── 1a. Cargar trail histórico del día al iniciar (AHORA EN BULK) ────────────
  // Optimizado: 1 solo request para todos los vendedores
  const loadHistoricalTrails = useCallback(async () => {
    try {
      const tzOffset = dayjs().format('Z');
      const { data: trailsData } = await api.get(`/api/trips/latest-trails?tzOffset=${tzOffset}`);
      if (!mounted.current) return;

      const newTrails = {};
      trailsData.forEach(row => {
        if (row.points?.length >= 2) {
          const trail = row.points.map(p => [p.lat, p.lng]);
          trails.current[row.employeeId] = trail;
          newTrails[row.employeeId] = trail;
        }
      });
      setLiveTrails(t => ({ ...t, ...newTrails }));
    } catch (e) {
      console.error('[SmartTracking] Error loading historical trails:', e);
    }
  }, []);

  // ── 1b. Heartbeat + live stops polling (cada 30s) ───────────────────────────
  // 🟡 3: Emite alertas de browser cuando un empleado cambia a offline/dead
  const prevHbRef = useRef({});
  const pollHeartbeat = useCallback(async () => {
    try {
      const { data } = await api.get('/api/locations/heartbeat-status');
      if (!mounted.current) return;
      const map = {};
      data.forEach((s) => {
        map[s.employeeId] = s;

        // 🟡 3: Alerta automática cuando el estado empeora
        const prev = prevHbRef.current[s.employeeId];
        if (prev && prev.liveStatus !== s.liveStatus) {
          const worsened =
            (s.liveStatus === 'offline' && (prev.liveStatus === 'alive' || prev.liveStatus === 'stale')) ||
            (s.liveStatus === 'dead'    && prev.liveStatus !== 'dead');

          if (worsened && 'Notification' in window && Notification.permission === 'granted') {
            const label = s.liveStatus === 'dead' ? '🔴 SIN SEÑAL' : '🟠 OFFLINE';
            const reason = s.reasonLabel || '';
            new Notification(`${label} — ${s.name}`, {
              body: reason ? `Razón: ${reason}` : `Sin datos por ${Math.round((s.ageSeconds || 0) / 60)}min`,
              icon: '/favicon.png',
              tag: `hb-${s.employeeId}`, // evita duplicados
            });
          }
        }
        prevHbRef.current[s.employeeId] = s;
      });
      setHeartbeatStatus(map);

      // Paradas activas en tiempo real
      try {
        const { data: stops } = await api.get('/api/locations/live-stops');
        if (mounted.current) setLiveStops(stops || []);
      } catch { /* silencioso */ }
    } catch {
      // silencioso — no crítico
    }
  }, []);

  // ── 1c. Queue stats polling (adaptativo) ────────────────────────────────────
  // - Si hay jobs pendientes: poll cada 10s (backpressure activo)
  // - Si cola vacía: poll cada 45s (ahorra requests)
  // 🔴 2: Reset detection — si completed baja, el worker se reinició
  // 🔴 5: Alertas automáticas: worker muerto >1min, failed creciente, waiting creciente
  const prevCompletedRef  = useRef(null);
  const prevQueueTsRef    = useRef(null);
  const prevWaitingRef    = useRef(null);
  const workerStaleRef    = useRef(null);   // timestamp cuando se detectó stale
  const prevFailedRef     = useRef(null);
  const queueTimerRef     = useRef(null);

  const scheduleNextQueuePoll = useCallback((waiting) => {
    if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
    // 🔴 3: Intervalo adaptativo según carga
    const nextMs = (waiting > 0) ? 10000 : 45000;
    queueTimerRef.current = setTimeout(pollQueueStatsRef.current, nextMs);
  }, []);

  // Usamos ref para que scheduleNextQueuePoll pueda llamar a pollQueueStats
  // sin crear dependencia circular en useCallback
  const pollQueueStatsRef = useRef(null);
  const pollQueueStats = useCallback(async () => {
    try {
      const { data } = await api.get('/api/locations/queue-stats');
      if (!mounted.current) return;

      // 🔴 2: Reset detection
      let jobsPerSec = null;
      const nowTs = Date.now();
      if (prevCompletedRef.current !== null && prevQueueTsRef.current !== null) {
        const deltaJobs = (data.completed || 0) - prevCompletedRef.current;
        const deltaSec  = (nowTs - prevQueueTsRef.current) / 1000;
        if (deltaJobs < 0) {
          // Worker se reinició — resetear cálculo, no publicar rate incorrecto
          prevCompletedRef.current = data.completed || 0;
          prevQueueTsRef.current   = nowTs;
        } else if (deltaSec > 0) {
          jobsPerSec = (deltaJobs / deltaSec).toFixed(2);
          prevCompletedRef.current = data.completed || 0;
          prevQueueTsRef.current   = nowTs;
        }
      } else {
        prevCompletedRef.current = data.completed || 0;
        prevQueueTsRef.current   = nowTs;
      }

      // 🔴 4: Backpressure threshold RELATIVO
      const rate = parseFloat(jobsPerSec) || 0;
      const backpressureThreshold = rate > 0 ? Math.ceil(rate * 10) : 100;
      const isBackpressure = (data.waiting || 0) > backpressureThreshold;

      // 🔴 5a: Alerta si worker muerto >1min
      if (data.workerStatus === 'stale' || data.workerStatus === 'no_stats') {
        if (!workerStaleRef.current) {
          workerStaleRef.current = nowTs;
        } else if (nowTs - workerStaleRef.current > 60000) {
          // >1 min muerto — notificar una sola vez por episodio
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🔴 Worker GPS caído', {
              body: `Sin procesar datos por más de 1 minuto. Revisar servidor.`,
              icon: '/favicon.png',
              tag: 'worker-dead',
            });
          }
          workerStaleRef.current = nowTs; // reset para no spamear
        }
      } else {
        workerStaleRef.current = null; // worker vivo — resetear
      }

      // 🔴 5b: Alerta si failed crece
      const currentFailed = data.failed || 0;
      if (prevFailedRef.current !== null && currentFailed > prevFailedRef.current + 5) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('⚠️ Jobs fallidos en cola', {
            body: `${currentFailed} jobs fallidos. Revisar DLQ.`,
            icon: '/favicon.png',
            tag: 'queue-failed',
          });
        }
      }
      prevFailedRef.current = currentFailed;

      // 🔴 5c: Alerta si waiting crece continuamente (3 polls seguidos)
      const currentWaiting = data.waiting || 0;
      if (prevWaitingRef.current !== null && currentWaiting > prevWaitingRef.current && isBackpressure) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('⚠️ Backpressure en cola GPS', {
            body: `${currentWaiting} jobs pendientes (umbral: ${backpressureThreshold}). Worker lento.`,
            icon: '/favicon.png',
            tag: 'queue-backpressure',
          });
        }
      }
      prevWaitingRef.current = currentWaiting;

      setQueueStats({ ...data, jobsPerSec, backpressureThreshold, isBackpressure });
    } catch {
      // silencioso — no crítico
    } finally {
      if (mounted.current) scheduleNextQueuePoll(queueStats?.waiting || 0);
    }
  }, [scheduleNextQueuePoll, queueStats?.waiting]);

  // Sincronizar ref con la función actual (evita stale closure en setTimeout)
  pollQueueStatsRef.current = pollQueueStats;

  // ── 2. Socket fast-path ──────────────────────────────────────────────────────
  const onSocketUpdate = useCallback((data) => {
    if (!data?.employeeId) return;
    const nowMs = Date.now();
    const prev  = raw.current[data.employeeId];

    raw.current[data.employeeId] = {
      ...(prev || {}),
      ...data,
      lastUpdate:      data.timestamp ? new Date(Number(data.timestamp)).toISOString() : new Date().toISOString(),
      _prevLat:        prev?.lat        ?? data.lat,
      _prevLng:        prev?.lng        ?? data.lng,
      _prevReceivedAt: prev?.receivedAt ?? nowMs - 3000,
      receivedAt:      nowMs,
    };

    // Acumular trail en vivo — máx 100 puntos, solo si hay coordenadas válidas
    if (data.lat && data.lng && data.lat !== 0 && data.lng !== 0 &&
        data.point_type !== 'heartbeat') {
      const empId = data.employeeId;
      const current = trails.current[empId] || [];
      const last = current[current.length - 1];
      // Solo agregar si se movió al menos 2m (evita duplicados de puntos quietos)
      const moved = !last || Math.abs(last[0] - data.lat) > 0.00002 || Math.abs(last[1] - data.lng) > 0.00002;
      if (moved) {
        trails.current[empId] = [...current.slice(-99), [data.lat, data.lng]];
        setLiveTrails(t => ({ ...t, [empId]: trails.current[empId] }));
      }
    }

    // Marcar como activo en vivo
    setLiveActiveIds((s) => new Set([...s, data.employeeId]));
  }, []);

  // ── 3. Tick de interpolación ─────────────────────────────────────────────────
  // Solo recalcula posiciones de vendedores en movimiento.
  // Vendedores quietos usan directamente raw.current (sin re-render innecesario).
  const tick = useCallback(() => {
    const nowMs   = Date.now();
    const entries = Object.entries(raw.current);
    if (entries.length === 0) return;

    let changed = false;
    const next  = {};

    entries.forEach(([id, point]) => {
      const age     = nowMs - point.receivedAt;
      const moving  = MOVING_STATES.has(point.state);
      const canInterp = moving && age < MAX_INTERP_MS && point._prevLat !== point.lat;

      if (canInterp) {
        const pos = lerp(
          { lat: point._prevLat, lng: point._prevLng, receivedAt: point._prevReceivedAt },
          { lat: point.lat,      lng: point.lng,      receivedAt: point.receivedAt },
          nowMs,
        );
        next[id] = { ...point, lat: pos.lat, lng: pos.lng };
        changed = true;
      } else {
        next[id] = point;
      }
    });

    // Solo actualiza el estado si algo cambió — evita re-renders innecesarios
    if (changed) setLocations(next);
    else setLocations((prev) => {
      // Sincronizar vendedores quietos sin forzar re-render si ya están igual
      const keys = Object.keys(raw.current);
      const needsSync = keys.some((id) => prev[id] !== raw.current[id]);
      return needsSync ? { ...raw.current } : prev;
    });
  }, []);

  // ── Setup ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;

    // 🟡 3: Solicitar permiso de notificaciones al montar (solo una vez)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    loadHistoricalTrails(); // Cargar trail del día al abrir el panel

    // Optimización: Solo pollear si la pestaña está visible
    const handlePolls = () => {
      if (document.hidden) return;
      poll();
      pollHeartbeat();
      pollQueueStats();
    };

    const pollTimer      = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    const interpTimer    = setInterval(tick, INTERP_MS);
    const heartbeatTimer = setInterval(() => { if (!document.hidden) pollHeartbeat(); }, HEARTBEAT_POLL_MS);

    // Evento de visibilidad para retomar polling inmediatamente al volver
    document.addEventListener('visibilitychange', handlePolls);

    socket.on('location_update', onSocketUpdate);

    return () => {
      mounted.current = false;
      clearInterval(pollTimer);
      clearInterval(interpTimer);
      clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', handlePolls);
      if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
      socket.off('location_update', onSocketUpdate);
    };
  }, [poll, tick, onSocketUpdate, pollHeartbeat, pollQueueStats, loadHistoricalTrails]);

  return { locations, liveActiveIds, isConnected, heartbeatStatus, queueStats, liveTrails, liveStops };
}
