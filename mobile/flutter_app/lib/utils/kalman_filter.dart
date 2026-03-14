/// Filtro Kalman para suavizar coordenadas GPS y eliminar ruido
/// FIX A1: q (process noise) ahora es dinámico según velocidad del objeto.
/// A mayor velocidad, mayor incertidumbre del proceso → el filtro sigue mejor al vehículo
/// en lugar de "resistirse" a los cambios rápidos.
class KalmanFilter {
  double estimate = 0;
  double errorEstimate = 1.0;

  /// r = measurement noise (error de GPS). Se adapta con accuracy.
  late double r;

  KalmanFilter({double? initialValue, double? gpsAccuracy}) {
    if (initialValue != null) estimate = initialValue;
    r = _rFromAccuracy(gpsAccuracy);
  }

  // ---------------------------------------------------------------------------
  // FIX A1: q dinámico — el ruido del proceso crece con la velocidad.
  // PARADO/WALKING: q pequeño (0.001 – 0.01) → suavizado agresivo.
  // DRIVING a alta velocidad: q grande (0.1 – 1.0) → seguimiento rápido.
  // ---------------------------------------------------------------------------
  static double _qFromSpeed(double? speedKmh) {
    final v = speedKmh ?? 0;
    if (v < 3) return 0.001;     // parado
    if (v < 15) return 0.01;     // caminando
    if (v < 60) return 0.05;     // ciudad
    if (v < 120) return 0.2;     // autopista
    return 0.5;                  // alta velocidad
  }

  static double _rFromAccuracy(double? gpsAccuracy) {
    return gpsAccuracy != null
        ? (gpsAccuracy / 100.0).clamp(0.01, 1.0)
        : 0.05;
  }

  /// Actualizar el filtro con una nueva medición.
  /// [speedKmh] opcional — si se pasa, q se recalcula dinámicamente.
  double update(double measurement, {double? gpsAccuracy, double? speedKmh}) {
    if (gpsAccuracy != null) r = _rFromAccuracy(gpsAccuracy);
    final q = _qFromSpeed(speedKmh);

    // Paso 1: Predicción del error estimado
    final predictedError = errorEstimate + q;

    // Paso 2: Ganancia Kalman
    final gain = predictedError / (predictedError + r);

    // Paso 3: Actualización de estimación
    estimate = estimate + gain * (measurement - estimate);

    // Paso 4: Actualización del error estimado
    errorEstimate = (1 - gain) * predictedError;

    return estimate;
  }

  /// Reset para cuando se cambia de posición de referencia (p. ej. tras DEEP_SLEEP)
  void reset({double? value, double? gpsAccuracy}) {
    estimate = value ?? 0;
    errorEstimate = 1.0;
    if (gpsAccuracy != null) r = _rFromAccuracy(gpsAccuracy);
  }

  double getEstimate() => estimate;
  double getError() => errorEstimate;
}

// ---------------------------------------------------------------------------
// Filtro 2D que aplica Kalman a lat y lng de forma coordinada
// ---------------------------------------------------------------------------
class LocationKalmanFilter {
  late KalmanFilter latFilter;
  late KalmanFilter lngFilter;

  LocationKalmanFilter({
    double? initialLat,
    double? initialLng,
    double? gpsAccuracy,
  }) {
    latFilter = KalmanFilter(initialValue: initialLat, gpsAccuracy: gpsAccuracy);
    lngFilter = KalmanFilter(initialValue: initialLng, gpsAccuracy: gpsAccuracy);
  }

  /// Actualiza ambas coordenadas.
  /// [speedKmh] se usa para calcular q dinámico en ambos ejes.
  Map<String, double> update(
    double lat,
    double lng, {
    double? gpsAccuracy,
    double? speedKmh,
  }) {
    return {
      'lat': latFilter.update(lat, gpsAccuracy: gpsAccuracy, speedKmh: speedKmh),
      'lng': lngFilter.update(lng, gpsAccuracy: gpsAccuracy, speedKmh: speedKmh),
    };
  }

  /// Resetear al cambiar de escenario (p. ej. DEEP_SLEEP → DRIVING)
  void reset({double? lat, double? lng, double? gpsAccuracy}) {
    latFilter.reset(value: lat, gpsAccuracy: gpsAccuracy);
    lngFilter.reset(value: lng, gpsAccuracy: gpsAccuracy);
  }
}
