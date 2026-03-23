// NUEVO ENDPOINT: POST /api/locations/batch
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db/postgres');
const redis = require('../services/queue').redis;
const { LocationKalmanFilter } = require('../utils/kalman_filter');

// Configuración de estados
const POLLING_CONFIG = {
  STOPPED: { interval: 60000, gpsAccurate: false },
  DEEP_SLEEP: { interval: 30000, gpsAccurate: false },
  WALKING: { interval: 5000, gpsAccurate: true },
  DRIVING: { interval: 3000, gpsAccurate: true },
  OFFLINE: { interval: 10000, gpsAccurate: true },
  PAUSED: { interval: 30000, gpsAccurate: false }
};

// Detecta el estado según velocidad y actividad
function detectState({ speed, activity, batteryLevel, isTrackingEnabled }) {
  if (!isTrackingEnabled || batteryLevel < 10) return 'STOPPED';
  if (activity === 'DRIVING' || speed > 4) return 'DRIVING';
  if (activity === 'WALKING' || (speed > 1 && speed <= 4)) return 'WALKING';
  if (speed <= 1) return 'DEEP_SLEEP';
  return 'OFFLINE';
}

// POST /api/locations/batch
router.post('/batch', auth, async (req, res) => {
  try {
    const { latitude, longitude, accuracy, speed, activity, timestamp, batteryLevel, state } = req.body;
    const employeeId = req.user.id;
    const isTrackingEnabled = req.user.is_tracking_enabled;

    // Validación básica
    if (!latitude || !longitude || !timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Filtrado Kalman (opcional)
    // const filtered = LocationKalmanFilter.filter({ latitude, longitude, accuracy, speed });
    // ...

    // Detectar estado
    const detectedState = detectState({ speed, activity, batteryLevel, isTrackingEnabled });

    // Guardar en DB
    await db.query(
      `INSERT INTO locations (employee_id, latitude, longitude, accuracy, speed, activity, timestamp, state, battery_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [employeeId, latitude, longitude, accuracy, speed, activity, timestamp, detectedState, batteryLevel]
    );

    // Guardar en Redis (para admins)
    await redis.set(`locations:${employeeId}`, JSON.stringify({
      latitude, longitude, accuracy, speed, activity, timestamp, state: detectedState, batteryLevel, lastUpdate: Date.now()
    }), 'EX', 600);

    // Responder con estado y config de polling
    res.json({
      state: detectedState,
      polling: POLLING_CONFIG[detectedState] || POLLING_CONFIG['DEEP_SLEEP'],
      confidence: 1.0 // TODO: calcular confianza real
    });
  } catch (err) {
    console.error('[ERROR] /api/locations/batch:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/locations/self
router.get('/self', auth, async (req, res) => {
  try {
    const employeeId = req.user.id;
    const cached = await redis.get(`locations:${employeeId}`);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    // Fallback: buscar en DB
    const result = await db.query('SELECT * FROM locations WHERE employee_id = $1 ORDER BY timestamp DESC LIMIT 1', [employeeId]);
    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }
    res.status(404).json({ error: 'No location found' });
  } catch (err) {
    console.error('[ERROR] /api/locations/self:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
