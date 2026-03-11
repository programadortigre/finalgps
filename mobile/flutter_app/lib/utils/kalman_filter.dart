/// Filtro Kalman para suavizar coordenadas GPS y eliminar ruido
/// Ajusta automáticamente según precisión del dispositivo
class KalmanFilter {
  double estimate = 0;
  double errorEstimate = 1.0;
  double q = 0.01;  // Process noise (movimiento del objeto)
  late double r;    // Measurement noise (error de GPS)

  KalmanFilter({double? initialValue, double? gpsAccuracy}) {
    if (initialValue != null) {
      estimate = initialValue;
    }
    // Usar precisión del GPS para ajustar el ruido de medición
    // A mayor accuracy (peor), más confía en la predicción
    r = gpsAccuracy != null ? (gpsAccuracy / 100.0).clamp(0.01, 1.0) : 0.05;
  }

  /// Actualizar el filtro con una nueva medición
  double update(double measurement, {double? gpsAccuracy}) {
    // Ajustar r dinámicamente si se proporciona nueva precisión
    if (gpsAccuracy != null) {
      r = (gpsAccuracy / 100.0).clamp(0.01, 1.0);
    }

    // Paso 1: Predecir error estimado (aumenta por incertidumbre del movimiento)
    final predictedError = errorEstimate + q;

    // Paso 2: Calcular ganancia Kalman (qué peso dar a la nueva medición)
    final gain = predictedError / (predictedError + r);

    // Paso 3: Actualizar estimación (media ponderada)
    estimate = estimate + gain * (measurement - estimate);

    // Paso 4: Actualizar error estimado (disminuye con nueva medición)
    errorEstimate = (1 - gain) * predictedError;

    return estimate;
  }

  /// Reset del filtro
  void reset({double? value}) {
    estimate = value ?? 0;
    errorEstimate = 1.0;
  }

  /// Obtener estado actual
  double getEstimate() => estimate;
  double getError() => errorEstimate;
}

/// Filtro 2D para suavizar coordenadas lat/lng en conjunto
class LocationKalmanFilter {
  late KalmanFilter latFilter;
  late KalmanFilter lngFilter;
  double lastLat = 0;
  double lastLng = 0;

  LocationKalmanFilter({
    double? initialLat,
    double? initialLng,
    double? gpsAccuracy,
  }) {
    latFilter = KalmanFilter(
      initialValue: initialLat,
      gpsAccuracy: gpsAccuracy,
    );
    lngFilter = KalmanFilter(
      initialValue: initialLng,
      gpsAccuracy: gpsAccuracy,
    );
    lastLat = initialLat ?? 0;
    lastLng = initialLng ?? 0;
  }

  /// Actualizar ambas coordenadas
  Map<String, double> update(
    double lat,
    double lng, {
    double? gpsAccuracy,
  }) {
    final filteredLat = latFilter.update(lat, gpsAccuracy: gpsAccuracy);
    final filteredLng = lngFilter.update(lng, gpsAccuracy: gpsAccuracy);

    lastLat = filteredLat;
    lastLng = filteredLng;

    return {
      'lat': filteredLat,
      'lng': filteredLng,
    };
  }

  void reset({double? lat, double? lng, double? gpsAccuracy}) {
    latFilter.reset(value: lat);
    lngFilter.reset(value: lng);
    lastLat = lat ?? 0;
    lastLng = lng ?? 0;
  }
}
