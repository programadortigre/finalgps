/**
 * useSmartTracking — Ver vendedores en vivo en el panel admin
 *
 * Cómo funciona:
 * 1. Polling HTTP cada 5s → fuente de verdad (funciona aunque el socket caiga)
 * 2. Socket → fast-path: actualiza la posición al instante cuando llega un punto
 * 3. Interpolación suave: entre dos puntos reales, el marcador se mueve gradualmente
 *    en lugar de saltar. Solo aplica a vendedores en movimiento (DRIVING / WALKING).
 *
 * Resultado: marcadores siempre actualizados, nunca congelados.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { socket } from '../services/socket';

const POLL_MS       = 5000;   // Polling HTTP cada 5s
const INTERP_MS     = 250;    // Tick de animación (4 fps — suficiente, no sobrecarga el browser)
const MAX_INTERP_MS = 15000;  // Dejar de interpolar si el punto tiene >15s de antigüedad

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

  const [locations, setLocations]       = useState({});
  const [liveActiveIds, setLiveActiveIds] = useState(new Set());
  const [isConnected, setIsConnected]   = useState(true);

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
          // Guardamos snapshot anterior para interpolar
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

    poll(); // Primer fetch inmediato
    const pollTimer  = setInterval(poll, POLL_MS);
    const interpTimer = setInterval(tick, INTERP_MS);

    socket.on('location_update', onSocketUpdate);

    return () => {
      mounted.current = false;
      clearInterval(pollTimer);
      clearInterval(interpTimer);
      socket.off('location_update', onSocketUpdate);
    };
  }, [poll, tick, onSocketUpdate]);

  return { locations, liveActiveIds, isConnected };
}
