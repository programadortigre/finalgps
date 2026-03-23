import 'dart:async';
import 'dart:math';
import 'package:sensors_plus/sensors_plus.dart';

/// MotionDetector — Zero Velocity Update (ZUPT)
///
/// Usa el acelerómetro para detectar si el dispositivo está realmente quieto.
/// Cuando está quieto, el GPS tiembla (drift) pero el acelerómetro no miente.
///
/// Técnica usada por Google/Uber:
/// - Mide la varianza de la magnitud del acelerómetro en una ventana de tiempo
/// - Si la varianza es < umbral → el dispositivo está quieto → no enviar GPS
/// - Si la varianza es > umbral → hay movimiento real → enviar GPS normalmente
class MotionDetector {
  // Ventana deslizante de muestras del acelerómetro (últimos ~1.5s a 50Hz)
  static const int _windowSize = 75;
  // Umbral de varianza: < 0.04 m²/s⁴ = quieto (calibrado empíricamente)
  // Google usa ~0.03, nosotros usamos 0.05 para ser más permisivos con vibraciones de bolsillo
  static const double _varianceThreshold = 0.05;
  // Mínimo de muestras antes de tomar decisión
  static const int _minSamples = 20;

  final List<double> _magnitudes = [];
  StreamSubscription<AccelerometerEvent>? _sub;
  bool _isStationary = false;
  DateTime _lastMotionTime = DateTime.now();

  // Callback que se llama cuando cambia el estado de movimiento
  final void Function(bool isStationary)? onStateChange;

  MotionDetector({this.onStateChange});

  void start() {
    _sub = accelerometerEventStream(
      samplingPeriod: const Duration(milliseconds: 20), // 50 Hz
    ).listen(_onAccelerometer);
  }

  void stop() {
    _sub?.cancel();
    _sub = null;
    _magnitudes.clear();
  }

  bool get isStationary => _isStationary;

  /// Tiempo desde el último movimiento detectado (útil para detectar paradas largas)
  Duration get timeSinceLastMotion => DateTime.now().difference(_lastMotionTime);

  void _onAccelerometer(AccelerometerEvent e) {
    // Magnitud del vector de aceleración (sin gravedad no es necesario aquí,
    // usamos la varianza que cancela la componente constante de gravedad)
    final mag = sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
    _magnitudes.add(mag);

    // Mantener ventana deslizante
    if (_magnitudes.length > _windowSize) {
      _magnitudes.removeAt(0);
    }

    if (_magnitudes.length < _minSamples) return;

    final variance = _computeVariance(_magnitudes);
    final nowStationary = variance < _varianceThreshold;

    if (nowStationary != _isStationary) {
      _isStationary = nowStationary;
      if (!nowStationary) _lastMotionTime = DateTime.now();
      onStateChange?.call(_isStationary);
    }

    if (!nowStationary) _lastMotionTime = DateTime.now();
  }

  static double _computeVariance(List<double> values) {
    if (values.isEmpty) return 0;
    final mean = values.reduce((a, b) => a + b) / values.length;
    final sumSq = values.fold(0.0, (acc, v) => acc + (v - mean) * (v - mean));
    return sumSq / values.length;
  }
}
