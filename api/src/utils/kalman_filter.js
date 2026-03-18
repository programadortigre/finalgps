/**
 * Filtro Kalman para suavizar datos GPS en el servidor
 * Reduce ruido y crea trazas más precisas
 */
class KalmanFilter {
  constructor(initialValue = 0, gpsAccuracy = 50) {
    this.estimate = initialValue;
    this.errorEstimate = 1.0;
    this.q = 0.01; // Process noise (Aumentado de 0.005 para seguir giros reales mejor)
    this.r = Math.max(0.01, (gpsAccuracy / 100).toFixed(2)); // Measurement noise
  }

  update(measurement, gpsAccuracy = null) {
    // Ajustar r dinámicamente si se proporciona nueva precisión
    if (gpsAccuracy !== null) {
      this.r = Math.max(0.01, (gpsAccuracy / 100).toFixed(2));
    }

    // Predicción: error estimado aumenta
    const predictedError = this.errorEstimate + this.q;

    // Ganancia Kalman: qué peso darle a la nueva medición
    const gain = predictedError / (predictedError + this.r);

    // Actualizar estimación (media ponderada)
    this.estimate = this.estimate + gain * (measurement - this.estimate);

    // Actualizar error (disminuye con nueva medición)
    this.errorEstimate = (1 - gain) * predictedError;

    return this.estimate;
  }

  reset(value = 0) {
    this.estimate = value;
    this.errorEstimate = 1.0;
  }
}

/**
 * Filtro Kalman 2D para coordenadas GPS
 */
class LocationKalmanFilter {
  constructor(initialLat = 0, initialLng = 0, gpsAccuracy = 50) {
    this.latFilter = new KalmanFilter(initialLat, gpsAccuracy);
    this.lngFilter = new KalmanFilter(initialLng, gpsAccuracy);
    this.lastLat = initialLat;
    this.lastLng = initialLng;
  }

  update(lat, lng, gpsAccuracy = null) {
    const filteredLat = this.latFilter.update(lat, gpsAccuracy);
    const filteredLng = this.lngFilter.update(lng, gpsAccuracy);

    this.lastLat = filteredLat;
    this.lastLng = filteredLng;

    return {
      lat: parseFloat(filteredLat.toFixed(8)),
      lng: parseFloat(filteredLng.toFixed(8)),
    };
  }

  reset(lat = 0, lng = 0) {
    this.latFilter.reset(lat);
    this.lngFilter.reset(lng);
    this.lastLat = lat;
    this.lastLng = lng;
  }

  getState() {
    return {
      latFilter: {
        estimate: this.latFilter.estimate,
        errorEstimate: this.latFilter.errorEstimate,
        q: this.latFilter.q,
        r: this.latFilter.r
      },
      lngFilter: {
        estimate: this.lngFilter.estimate,
        errorEstimate: this.lngFilter.errorEstimate,
        q: this.lngFilter.q,
        r: this.lngFilter.r
      },
      lastLat: this.lastLat,
      lastLng: this.lastLng
    };
  }

  setState(state) {
    if (state) {
      if (state.latFilter) {
        this.latFilter.estimate = state.latFilter.estimate;
        this.latFilter.errorEstimate = state.latFilter.errorEstimate;
        this.latFilter.q = state.latFilter.q;
        this.latFilter.r = state.latFilter.r;
      }
      if (state.lngFilter) {
        this.lngFilter.estimate = state.lngFilter.estimate;
        this.lngFilter.errorEstimate = state.lngFilter.errorEstimate;
        this.lngFilter.q = state.lngFilter.q;
        this.lngFilter.r = state.lngFilter.r;
      }
      if (state.lastLat !== undefined) this.lastLat = state.lastLat;
      if (state.lastLng !== undefined) this.lastLng = state.lastLng;
    }
  }
}

module.exports = { KalmanFilter, LocationKalmanFilter };
