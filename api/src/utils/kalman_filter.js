/**
 * Filtro Kalman para suavizar datos GPS en el servidor
 * Reduce ruido y crea trazas más precisas
 */
class KalmanFilter {
  constructor(initialValue = 0, gpsAccuracy = 50) {
    this.estimate = initialValue;
    this.errorEstimate = 1.0;
    this.q = 0.005; // Process noise (movimiento del objeto)
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
}

module.exports = { KalmanFilter, LocationKalmanFilter };
