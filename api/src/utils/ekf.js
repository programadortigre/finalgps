/**
 * Extended Kalman Filter para GPS — igual que usan Google/Uber internamente
 *
 * Estado: [lat, lng, velocidad_ms, heading_rad]
 *
 * Por qué es mejor que el Kalman 1D:
 * - El 1D filtra cada coordenada por separado, sin saber que lat y lng están relacionadas
 *   por la velocidad y dirección del movimiento.
 * - El EKF modela la física: si vas a 60 km/h hacia el norte, el siguiente punto
 *   DEBE estar ~83m al norte. Si el GPS dice que estás 200m al este, lo rechaza.
 * - Elimina el "GPS drift" estando quieto porque el modelo predice velocidad=0
 *   y cualquier movimiento GPS es ruido.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_R  = 6371000; // metros

/** Convierte metros de desplazamiento a grados de latitud */
function metersToLatDeg(meters) { return (meters / EARTH_R) * RAD2DEG; }

/** Convierte metros de desplazamiento a grados de longitud dado una latitud */
function metersToLngDeg(meters, lat) {
  return (meters / (EARTH_R * Math.cos(lat * DEG2RAD))) * RAD2DEG;
}

class GPSKalmanEKF {
  /**
   * @param {number} initLat
   * @param {number} initLng
   * @param {number} initSpeedMs  velocidad inicial en m/s
   * @param {number} initHeadingDeg  heading inicial en grados (0=Norte)
   * @param {number} gpsAccuracyM  precisión GPS inicial en metros
   */
  constructor(initLat, initLng, initSpeedMs = 0, initHeadingDeg = 0, gpsAccuracyM = 20) {
    // Vector de estado: [lat, lng, speed_ms, heading_rad]
    this.x = [initLat, initLng, initSpeedMs, initHeadingDeg * DEG2RAD];

    // Covarianza del estado (incertidumbre inicial)
    // Diagonal: [lat_var, lng_var, speed_var, heading_var]
    this.P = [
      [1e-8, 0,    0,   0   ],
      [0,    1e-8, 0,   0   ],
      [0,    0,    4,   0   ],  // ±2 m/s de incertidumbre inicial en velocidad
      [0,    0,    0,   0.5 ],  // ±0.5 rad de incertidumbre inicial en heading
    ];

    // Ruido del proceso (cuánto puede cambiar el estado entre mediciones)
    // Valores más altos = el filtro sigue mejor cambios bruscos pero es menos suave
    this._baseQ = {
      lat:     1e-10,  // ~1m de incertidumbre por segundo
      lng:     1e-10,
      speed:   0.5,    // puede cambiar ±0.5 m/s por segundo (aceleración normal)
      heading: 0.1,    // puede girar ±0.1 rad/s (~6°/s)
    };

    // Ruido de medición GPS (se adapta con accuracy)
    this._setMeasurementNoise(gpsAccuracyM);

    this._lastTimestamp = null;
    this._initialized = true;
  }

  _setMeasurementNoise(accuracyM) {
    // Convertir metros de precisión GPS a varianza en grados²
    const latVar = Math.pow(metersToLatDeg(accuracyM), 2);
    const lngVar = Math.pow(metersToLngDeg(accuracyM, this.x[0]), 2);
    // R: matriz de ruido de medición [lat, lng]
    this.R = [
      [latVar, 0     ],
      [0,      lngVar],
    ];
  }

  /**
   * Predice el estado siguiente dado dt segundos transcurridos.
   * Modelo de movimiento: posición += velocidad * dt en la dirección del heading
   */
  _predict(dt) {
    const [lat, lng, speed, heading] = this.x;

    // Desplazamiento en metros
    const distM = speed * dt;
    const dLat  = metersToLatDeg(distM * Math.cos(heading));
    const dLng  = metersToLngDeg(distM * Math.sin(heading), lat);

    // Estado predicho (el heading y speed se asumen constantes)
    this.x = [lat + dLat, lng + dLng, speed, heading];

    // Jacobiano de la función de transición F (linealización)
    // Solo las derivadas no triviales:
    const dDistM_dSpeed   = dt;
    const dLat_dHeading   = metersToLatDeg(-distM * Math.sin(heading));
    const dLng_dHeading   = metersToLngDeg( distM * Math.cos(heading), lat);

    const F = [
      [1, 0, metersToLatDeg(dt * Math.cos(heading)), dLat_dHeading],
      [0, 1, metersToLngDeg(dt * Math.sin(heading), lat), dLng_dHeading],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];

    // Ruido del proceso Q (escala con dt)
    const Q = [
      [this._baseQ.lat * dt,     0,                        0,                      0                     ],
      [0,                        this._baseQ.lng * dt,     0,                      0                     ],
      [0,                        0,                        this._baseQ.speed * dt, 0                     ],
      [0,                        0,                        0,                      this._baseQ.heading * dt],
    ];

    // P = F * P * F^T + Q
    this.P = matAdd(matMul(matMul(F, this.P), matTranspose(F)), Q);
  }

  /**
   * Actualiza el estado con una nueva medición GPS.
   * @param {number} measLat
   * @param {number} measLng
   * @param {number} measSpeedMs  velocidad reportada por GPS (m/s)
   * @param {number} measHeadingDeg  heading reportado por GPS (grados)
   * @param {number} accuracyM  precisión GPS en metros
   * @param {number} timestampMs  timestamp de la medición
   * @returns {{ lat, lng, speed, heading, rejected }} estado actualizado
   */
  update(measLat, measLng, measSpeedMs, measHeadingDeg, accuracyM, timestampMs) {
    if (!this._lastTimestamp) {
      this._lastTimestamp = timestampMs;
      this.x[0] = measLat;
      this.x[1] = measLng;
      this.x[2] = measSpeedMs;
      this.x[3] = measHeadingDeg * DEG2RAD;
      return this._result(false);
    }

    const dt = Math.min((timestampMs - this._lastTimestamp) / 1000, 30); // máx 30s
    this._lastTimestamp = timestampMs;

    if (dt <= 0) return this._result(false, "dt <= 0");

    // ── Predicción ──────────────────────────────────────────────────────────
    this._predict(dt);

    // ── Validación de salto imposible (gate test) ────────────────────────────
    // Si el punto GPS está a más de 5σ del estado predicho, es un outlier → rechazar
    const [predLat, predLng] = this.x;
    const dLatM = (measLat - predLat) / metersToLatDeg(1);
    const dLngM = (measLng - predLng) / metersToLngDeg(1, predLat);
    const distFromPred = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
    const maxExpected  = 5 * Math.sqrt(this.P[0][0] / Math.pow(metersToLatDeg(1), 2) + accuracyM * accuracyM);

    if (distFromPred > maxExpected && distFromPred > 50) {
      // Punto demasiado lejos de lo predicho — probablemente ruido GPS
      // No actualizar, pero sí avanzar el tiempo
      return this._result(true, `Outlier: distFromPred=${distFromPred.toFixed(1)}m > maxExpected=${maxExpected.toFixed(1)}m`);
    }

    // ── Actualización (corrección) ───────────────────────────────────────────
    this._setMeasurementNoise(accuracyM);

    // Innovación: diferencia entre medición y predicción
    const y = [measLat - this.x[0], measLng - this.x[1]];

    // Matriz de observación H (solo observamos lat y lng)
    const H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];

    // S = H * P * H^T + R
    const HP  = matMul(H, this.P);
    const HPHt = matMul(HP, matTranspose(H));
    const S   = matAdd(HPHt, this.R);

    // Ganancia de Kalman K = P * H^T * S^-1
    const PHt = matMul(this.P, matTranspose(H));
    const Sinv = mat2x2Inv(S);
    const K   = matMul(PHt, Sinv);

    // Actualizar estado: x = x + K * y
    const Ky = matVecMul(K, y);
    this.x = this.x.map((v, i) => v + Ky[i]);

    // Normalizar heading a [-π, π]
    this.x[3] = ((this.x[3] + Math.PI) % (2 * Math.PI)) - Math.PI;

    // Actualizar covarianza: P = (I - K*H) * P
    const KH = matMul(K, H);
    const I  = identity(4);
    const IKH = matSub(I, KH);
    this.P = matMul(IKH, this.P);

    // Actualizar velocidad y heading con los valores del GPS si son confiables
    if (measSpeedMs >= 0 && accuracyM < 30) {
      this.x[2] = 0.7 * this.x[2] + 0.3 * measSpeedMs;
      if (measSpeedMs > 0.5) {
        const measHeadingRad = measHeadingDeg * DEG2RAD;
        this.x[3] = 0.8 * this.x[3] + 0.2 * measHeadingRad;
      }
    }

    return this._result(false);
  }

  _result(rejected, reason = null) {
    return {
      lat:      this.x[0],
      lng:      this.x[1],
      speed:    Math.max(0, this.x[2]),
      heading:  this.x[3] * RAD2DEG,
      rejected,
      rejectReason: reason
    };
  }

  /** Serializar para guardar en Redis entre llamadas */
  serialize() {
    return { x: this.x, P: this.P, lastTs: this._lastTimestamp };
  }

  /** Restaurar desde Redis */
  static deserialize(data, gpsAccuracyM = 20) {
    const ekf = new GPSKalmanEKF(data.x[0], data.x[1], data.x[2], data.x[3] * RAD2DEG, gpsAccuracyM);
    ekf.x = data.x;
    ekf.P = data.P;
    ekf._lastTimestamp = data.lastTs;
    return ekf;
  }
}

// ─── Álgebra matricial mínima ─────────────────────────────────────────────────

function matMul(A, B) {
  const rows = A.length, cols = B[0].length, inner = B.length;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) =>
      Array.from({ length: inner }, (_, k) => A[i][k] * B[k][j]).reduce((a, b) => a + b, 0)
    )
  );
}

function matAdd(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function matSub(A, B) {
  return A.map((row, i) => row.map((v, j) => v - B[i][j]));
}

function matTranspose(A) {
  return A[0].map((_, j) => A.map(row => row[j]));
}

function matVecMul(A, v) {
  return A.map(row => row.reduce((sum, val, j) => sum + val * v[j], 0));
}

function identity(n) {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
}

function mat2x2Inv(M) {
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  if (Math.abs(det) < 1e-20) return [[1, 0], [0, 1]]; // fallback
  return [
    [ M[1][1] / det, -M[0][1] / det],
    [-M[1][0] / det,  M[0][0] / det],
  ];
}

module.exports = { GPSKalmanEKF };
