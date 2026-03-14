import 'dart:async';
import 'dart:ui';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:geolocator/geolocator.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_activity_recognition/flutter_activity_recognition.dart' as ar;
import 'api_service.dart';
import 'local_storage.dart';
import '../models/local_point.dart';
import '../utils/kalman_filter.dart';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
void _log(String tag, String message) {
  // ignore: avoid_print
  print('[$tag] $message');
}

// ---------------------------------------------------------------------------
// Estado de tracking compartido
// ---------------------------------------------------------------------------
enum TrackingState {
  STOPPED,
  DEEP_SLEEP,
  WALKING,
  DRIVING,
  BATT_SAVER,
  NO_SIGNAL
}

// ---------------------------------------------------------------------------
// TrackingEngine — TODA la lógica de estado en una clase instanciada.
// Evita el anti-patrón de variables globales que se reinician al crash del OS.
// ---------------------------------------------------------------------------
class TrackingEngine {
  // ── Dependencias ──────────────────────────────────────────────────────────
  final ApiService _api;
  final LocalStorage _storage;
  final Battery _battery = Battery();

  // ── Estado interno ─────────────────────────────────────────────────────────
  TrackingState _currentState = TrackingState.STOPPED;
  DateTime _lastValidLocationTime = DateTime.now();
  LocalPoint? _lastValidPoint;
  int _stationaryTicks = 0;
  int _duplicatePointCount = 0;
  double _lastRawLat = 0;
  double _lastRawLng = 0;
  LocationKalmanFilter? _locationFilter;

  // FIX C5: guardamos la referencia al ServiceInstance para siempre estar disponible
  ServiceInstance? _serviceInstance;

  // ── Subscripciones ─────────────────────────────────────────────────────────
  StreamSubscription<Position>? _positionStreamSub;
  StreamSubscription<ar.Activity>? _activityStreamSub;

  // FIX C3: referencias a timers para cancelación limpia
  Timer? _watchdogTimer;
  Timer? _batchTimer;
  Timer? _emitterTimer;

  // FIX A3: employeeId cacheado en memoria (no leer FlutterSecureStorage cada punto)
  int? _cachedEmployeeId;

  // Contador de ticks del watchdog para limpieza periódica de DB
  int _watchdogTicks = 0;
  static const int _cleanupIntervalTicks = 1440; // 1440 × 60s = 24 horas

  // ── Constructor: inicialización segura (sin `late`) ───────────────────────
  TrackingEngine({required ApiService api, required LocalStorage storage})
      : _api = api,
        _storage = storage;

  // ---------------------------------------------------------------------------
  // Arranque del motor
  // ---------------------------------------------------------------------------
  Future<void> start(ServiceInstance service) async {
    _serviceInstance = service;

    // FIX A3: cachear employeeId desde el inicio
    await _loadCachedEmployeeId();

    // FIX C1: restaurar último punto válido desde SQLite
    await _restoreStateFromStorage();

    // Wake lock solo cuando sea necesario (ver _applyWakelock)
    _applyWakelock();

    // 1. Activity Recognition
    await _initActivityRecognition();

    // 2. Stream GPS
    _startLocationStream();

    // 3. Watchdog — FIX C3: guardamos referencia
    _watchdogTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      _checkWatchdog();
    });

    // 4. Batch Uploader — FIX C3: guardamos referencia
    _batchTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _flushPoints();
    });

    // 5. Emitter al UI — FIX C3: guardamos referencia
    _emitterTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _serviceInstance?.invoke('trackingState', {
        'is_active': true,
        'state': _currentState.name,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Parada limpia del motor
  // FIX C3: cancelar TODOS los timers y suscripciones
  // ---------------------------------------------------------------------------
  void stop() {
    _log('SYS', 'TrackingEngine.stop() — cancelando todos los recursos');

    _watchdogTimer?.cancel();
    _batchTimer?.cancel();
    _emitterTimer?.cancel();

    _positionStreamSub?.cancel();
    _activityStreamSub?.cancel();

    try {
      WakelockPlus.disable();
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // FIX A3: Cargar employeeId una sola vez en memoria
  // ---------------------------------------------------------------------------
  Future<void> _loadCachedEmployeeId() async {
    try {
      final userIdStr = await _api.getUserId();
      _cachedEmployeeId = int.tryParse(userIdStr ?? '');
      _log('INIT', 'EmployeeId cacheado: $_cachedEmployeeId');
    } catch (e) {
      _log('INIT', 'Error cargando employeeId: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // FIX C1: Restaurar último estado desde SQLite para sobrevivir reinicios del OS
  // ---------------------------------------------------------------------------
  Future<void> _restoreStateFromStorage() async {
    try {
      final lastPoint = await _storage.getLastValidPoint();
      if (lastPoint != null) {
        _lastValidPoint = lastPoint;
        _lastValidLocationTime = DateTime.fromMillisecondsSinceEpoch(lastPoint.timestamp);
        _log('RESTORE', 'Último punto restaurado: ${lastPoint.lat}, ${lastPoint.lng} '
            '@ ${_lastValidLocationTime.toIso8601String()}');

        // Inicializar el Kalman filter en la última posición conocida
        _locationFilter = LocationKalmanFilter(
          initialLat: lastPoint.lat,
          initialLng: lastPoint.lng,
          gpsAccuracy: lastPoint.accuracy,
        );
      } else {
        _log('RESTORE', 'Sin estado previo en SQLite — arranque fresco');
      }
    } catch (e) {
      _log('RESTORE', 'Error restaurando estado: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // FIX A2: Wake Lock adaptativo según estado
  // ---------------------------------------------------------------------------
  void _applyWakelock() {
    try {
      final needsWakelock = _currentState == TrackingState.DRIVING ||
          _currentState == TrackingState.WALKING ||
          _currentState == TrackingState.NO_SIGNAL;

      if (needsWakelock) {
        WakelockPlus.enable();
      } else {
        WakelockPlus.disable();
      }
    } catch (e) {
      _log('SYS', 'Wakelock error: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Activity Recognition
  // ---------------------------------------------------------------------------
  Future<void> _initActivityRecognition() async {
    try {
      var status = await Permission.activityRecognition.status;
      if (status.isDenied) {
        status = await Permission.activityRecognition.request();
      }
      if (status.isGranted) {
        final activityRecognition = ar.FlutterActivityRecognition.instance;
        _activityStreamSub =
            activityRecognition.activityStream.listen((activity) {
          _log('ACTIVITY',
              'Detectado: ${activity.type.name} (Confianza: ${activity.confidence})');
          _updateStateFromActivity(activity.type);
        });
      } else {
        _log('ACTIVITY', 'Permiso denegado: $status');
      }
    } catch (e) {
      _log('ACTIVITY', 'Error de inicialización: $e');
    }
  }

  void _updateStateFromActivity(ar.ActivityType type) {
    if (_currentState == TrackingState.BATT_SAVER) return;

    TrackingState newState = _currentState;
    if (type == ar.ActivityType.IN_VEHICLE) {
      newState = TrackingState.DRIVING;
    } else if (type == ar.ActivityType.WALKING ||
        type == ar.ActivityType.RUNNING ||
        type == ar.ActivityType.ON_BICYCLE) {
      newState = TrackingState.WALKING;
    }

    if (newState != _currentState &&
        (newState == TrackingState.DRIVING ||
            newState == TrackingState.WALKING)) {
      if (_currentState == TrackingState.DEEP_SLEEP ||
          _currentState == TrackingState.STOPPED) {
        _log('STATE', 'Wakeup por Actividad: ${newState.name}');
        _currentState = newState;
        _applyWakelock();
        _restartLocationStream();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Watchdog
  // ---------------------------------------------------------------------------
  Future<void> _checkWatchdog() async {
    final now = DateTime.now();
    final diff = now.difference(_lastValidLocationTime).inSeconds;

    // 1. Health Check (Heartbeat) - Cada 5 minutos (5 ticks de 60s)
    _watchdogTicks++;
    if (_watchdogTicks % 5 == 0) {
      try {
        final level = await _battery.batteryLevel;
        final stats = await _storage.getStats();
        final unsynced = stats['unsynced'] ?? 0;
        _log('HEALTH', 'HB: State=$_currentState | Batt=$level% | Buffer=$unsynced pts | LastLoc=${diff}s ago');
      } catch (e) {
        _log('HEALTH', 'HB Error: $e');
      }
    }

    // 2. Chequeo de batería (crítico)
    try {
      final level = await _battery.batteryLevel;
      if (level < 15 && _currentState != TrackingState.BATT_SAVER) {
        _log('STATE', 'Batería crítica <15%. Forzando BATT_SAVER');
        _setState(TrackingState.BATT_SAVER);
        return;
      } else if (level >= 15 && _currentState == TrackingState.BATT_SAVER) {
        _setState(TrackingState.STOPPED);
      }
    } catch (e) {
      _log('BATT', 'Sensor batería falló: $e');
    }

    if (_currentState == TrackingState.BATT_SAVER) return;

    // 2. Deep Sleep extremo (>10 min sin movimiento)
    if (_currentState == TrackingState.STOPPED && diff > 600) {
      _log('STATE', 'Inmóvil >10min — DEEP_SLEEP');
      _setState(TrackingState.DEEP_SLEEP);
      return;
    }

    // 3. Watchdog de señal GPS (>2 min sin lectura)
    if (diff > 120 && _currentState != TrackingState.DEEP_SLEEP) {
      _log('WATCHDOG', 'Timeout GPS ${diff}s — posible túnel/crash. Reiniciando.');
      _setState(TrackingState.NO_SIGNAL, reason: 'Watchdog Timeout');
    }

    // 4. Limpieza periódica de DB: cada 24h eliminar puntos sincronizados viejos
    if (_watchdogTicks >= _cleanupIntervalTicks) {
      _watchdogTicks = 0;
      _log('STORAGE', 'Limpieza periódica de DB iniciada (24h)...');
      _storage.cleanOldSyncedPoints(daysToKeep: 7);
    }
  }

  // ---------------------------------------------------------------------------
  // Cambio de estado con efectos secundarios
  // ---------------------------------------------------------------------------
  void _setState(TrackingState newState, {String? reason}) {
    if (newState == _currentState) return;
    _log('STATE', '${_currentState.name} → ${newState.name} ${reason != null ? "($reason)" : ""}');
    _currentState = newState;
    _applyWakelock();
    _restartLocationStream(reason: reason ?? 'State Change');
  }

  // ---------------------------------------------------------------------------
  // Stream GPS adaptativo
  // ---------------------------------------------------------------------------
  void _startLocationStream({String? reason}) {
    _positionStreamSub?.cancel();

    // FIX A6: resetear stationaryTicks en cada nuevo stream
    _stationaryTicks = 0;

    int intervalSec;
    int distanceFilter;
    LocationAccuracy accuracy;

    switch (_currentState) {
      case TrackingState.DEEP_SLEEP:
      case TrackingState.BATT_SAVER:
        intervalSec = 300;
        distanceFilter = 50;
        accuracy = LocationAccuracy.low;
        break;
      case TrackingState.STOPPED:
        intervalSec = 30; // REDUCIDO de 120s para detectar movimiento más rápido
        distanceFilter = 10;
        accuracy = LocationAccuracy.medium;
        break;
      case TrackingState.WALKING:
        intervalSec = 15;
        distanceFilter = 5;
        accuracy = LocationAccuracy.high;
        break;
      case TrackingState.DRIVING:
      case TrackingState.NO_SIGNAL:
        intervalSec = 5;
        distanceFilter = 10;
        accuracy = LocationAccuracy.bestForNavigation;
        break;
    }

    _log('GPS',
        'Stream START ($reason) → State:${_currentState.name} Interval:${intervalSec}s Dist:${distanceFilter}m Acc:${accuracy.name}');

    _positionStreamSub = Geolocator.getPositionStream(
      locationSettings: AndroidSettings(
        accuracy: accuracy,
        distanceFilter: distanceFilter,
        intervalDuration: Duration(seconds: intervalSec),
        forceLocationManager: false,
        foregroundNotificationConfig: ForegroundNotificationConfig(
          notificationText: 'Monitoreando: ${_currentState.name}',
          notificationTitle: 'GPS Activo',
          enableWakeLock: _currentState != TrackingState.DEEP_SLEEP,
        ),
      ),
    ).listen(
      (Position pos) => _processNewPosition(pos),
      onError: (e) {
        _log('GPS', 'Error fatal del stream: $e');
        Future.delayed(
            const Duration(seconds: 15), _restartLocationStream);
      },
    );
  }

  void _restartLocationStream({String? reason}) => _startLocationStream(reason: reason);

  // ---------------------------------------------------------------------------
  // Procesamiento de cada posición GPS
  // ---------------------------------------------------------------------------
  Future<void> _processNewPosition(Position pos) async {
    try {
      final double speedKmh = pos.speed * 3.6;

      // ── Filtro 0: GPS hardware en loop ─────────────────────────────────────
      if (pos.latitude == _lastRawLat && pos.longitude == _lastRawLng) {
        _duplicatePointCount++;
        if (_duplicatePointCount >= 10) {
          _log('WATCHDOG', 'GPS en loop (misma posición ×10) — purga y reinicio');
          _duplicatePointCount = 0;
          _restartLocationStream();
          return;
        }
      } else {
        _lastRawLat = pos.latitude;
        _lastRawLng = pos.longitude;
        _duplicatePointCount = 0;
      }

      _lastValidLocationTime = DateTime.now();

      // ── Votación híbrida de estado ─────────────────────────────────────────
      if (_currentState != TrackingState.DEEP_SLEEP &&
          _currentState != TrackingState.BATT_SAVER) {
        TrackingState votedState = _currentState;
        if (speedKmh > 12.0) {
          votedState = TrackingState.DRIVING;
        } else if (speedKmh > 2.0 && speedKmh <= 12.0) {
          votedState = TrackingState.WALKING;
        } else if (speedKmh <= 2.0) {
          _stationaryTicks++;
          if (_stationaryTicks > 8) votedState = TrackingState.STOPPED;
        }
        if (speedKmh > 2.0) _stationaryTicks = 0;

        if (votedState != _currentState) {
          _log('STATE',
              '${_currentState.name} → ${votedState.name} (vel=${speedKmh.toStringAsFixed(1)} km/h)');
          _currentState = votedState;
          _applyWakelock();
          _restartLocationStream();
          return;
        }
      }

      // ── Filtros de calidad ─────────────────────────────────────────────────
      double distToLast = 0.0;
      if (_lastValidPoint != null) {
        distToLast = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng,
          pos.latitude, pos.longitude,
        );

        // 3A: precisión dinámica
        if (pos.accuracy > 35 && distToLast < (pos.accuracy * 0.4)) {
          // Solo loggear si la precisión es realmente mala (>100m)
          if (pos.accuracy > 100) {
            _log('FILTER', 'DROP-3A: acc=${pos.accuracy}m (Threshold 100m exceeded)');
          }
          return;
        }
      } else if (pos.accuracy > 40) {
        if (pos.accuracy > 100) {
          _log('FILTER', 'DROP-3A: First point accuracy=${pos.accuracy}m (Too high)');
        }
        return;
      }

      // 3B: velocidad máxima física
      if (speedKmh > 200) {
        _log('FILTER', 'DROP-3B: velocidad imposible ${speedKmh.toStringAsFixed(1)} km/h');
        return;
      }

      // 3C: aceleración promedio imposible
      if (_lastValidPoint != null) {
        final timeSecs =
            (DateTime.now().millisecondsSinceEpoch - _lastValidPoint!.timestamp) /
                1000.0;
        if (timeSecs > 0) {
          final avgSpeed = (distToLast / timeSecs) * 3.6;
          if (avgSpeed > 180) {
            // Solo loggear si el salto es masivo (>500m)
            if (distToLast > 500) {
              _log('FILTER', 'DROP-3C: Jump detected dist=${distToLast.toStringAsFixed(0)}m avgSpeed=${avgSpeed.toStringAsFixed(0)}km/h');
            }
            return;
          }
        }
      }

      // 3D: micro-paso en conducción
      if (_currentState == TrackingState.DRIVING &&
          distToLast > 0 &&
          distToLast < 4) {
        _log('FILTER',
            'DROP-3D: micro-paso inercial ${distToLast.toStringAsFixed(1)}m en DRIVING');
        return;
      }

      // ── FIX A1: Kalman con q dinámico basado en velocidad ─────────────────
      _locationFilter ??= LocationKalmanFilter(
        initialLat: pos.latitude,
        initialLng: pos.longitude,
        gpsAccuracy: pos.accuracy,
      );
      final filtered = _locationFilter!.update(
        pos.latitude, pos.longitude,
        gpsAccuracy: pos.accuracy,
        speedKmh: speedKmh,  // q dinámico
      );
      final double finalLat = filtered['lat']!;
      final double finalLng = filtered['lng']!;

      // ── Anti-Drift ─────────────────────────────────────────────────────────
      if (_currentState == TrackingState.STOPPED && _lastValidPoint != null) {
        final driftDist = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng, finalLat, finalLng,
        );
        if (driftDist < 15) {
          _log('FILTER', 'DROP-DRIFT: ${driftDist.toStringAsFixed(1)}m descartado');
          return;
        }
      }

      // ── Deduplicación exacta ───────────────────────────────────────────────
      if (_lastValidPoint != null &&
          _lastValidPoint!.lat == finalLat &&
          _lastValidPoint!.lng == finalLng) {
        return;
      }

      // FIX A3: usar employeeId cacheado
      if (_cachedEmployeeId == null) {
        // Intentar cargar de nuevo (token puede haberse renovado)
        await _loadCachedEmployeeId();
        if (_cachedEmployeeId == null) return;
      }

      final point = LocalPoint(
        lat: finalLat,
        lng: finalLng,
        speed: speedKmh,
        accuracy: pos.accuracy,
        state: _currentState.name,
        timestamp: DateTime.now().millisecondsSinceEpoch,
        employeeId: _cachedEmployeeId,
      );

      // FIX: insertar ANTES de actualizar _lastValidPoint para mantener consistencia
      final insertedId = await _storage.insertPoint(point);
      if (insertedId > 0) {
        _lastValidPoint = point;
      } else {
        _log('STORAGE', 'insertPoint retornó 0 — punto NO guardado');
        return;
      }

      // FIX C5: _serviceInstance siempre disponible
      final svc = _serviceInstance;
      if (svc != null && svc is AndroidServiceInstance) {
        svc.invoke('trackingLocation', {
          'lat': finalLat,
          'lng': finalLng,
          'speed': speedKmh,
          'accuracy': pos.accuracy,
          'state': _currentState.name,
        });

        try {
          if (await svc.isForegroundService()) {
            final stats = await _storage.getStats();
            final count = stats['unsynced'] ?? 0;
            svc.setForegroundNotificationInfo(
              title: 'Rastreo: ${_currentState.name} (${pos.accuracy.toStringAsFixed(1)}m)',
              content: 'Vel: ${speedKmh.toStringAsFixed(1)} km/h | Cola: $count pts',
            );
          }
        } catch (_) {
          // fallos del notificador no tumban el pipeline
        }
      }
    } catch (e, stack) {
      _log('CRITICAL', 'Error en processNewPosition: $e\n$stack');
    }
  }

  // ---------------------------------------------------------------------------
  // Batch Upload
  // ---------------------------------------------------------------------------
  Future<void> _flushPoints() async {
    try {
      final token = await _api.getToken();
      if (token == null) return;

      final unsyncedPoints = await _storage.getUnsyncedPoints(limit: 50);
      if (unsyncedPoints.isEmpty) return;

      final data = unsyncedPoints.map((p) => {
        'lat': p.lat,
        'lng': p.lng,
        'speed': p.speed,
        'accuracy': p.accuracy,
        'state': p.state,
        'timestamp': p.timestamp,
      }).toList();

      _log('BATCH', 'Enviando ${data.length} puntos...');
      final ok = await _api.uploadBatch(data);
      if (ok) {
        final ids = unsyncedPoints.map((p) => p.id!).toList();
        await _storage.markPointsAsSynced(ids);
        _log('BATCH', 'Éxito: ${ids.length} puntos sincronizados');
      }
    } catch (e) {
      _log('BATCH', 'Error de red/batch: $e');
    }
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada del background isolate
// ---------------------------------------------------------------------------

// Instancia ÚNICA del motor — por isolate (no es global compartido)
TrackingEngine? _engine;

Future<void> initializeService() async {
  final service = FlutterBackgroundService();
  await service.configure(
    androidConfiguration: AndroidConfiguration(
      onStart: onStart,
      autoStart: true,
      isForegroundMode: true,
      notificationChannelId: 'gps_tracking_channel',
      initialNotificationTitle: 'GPS Tracking Activo',
      initialNotificationContent: 'Iniciando sistema...',
      foregroundServiceNotificationId: 888,
    ),
    iosConfiguration: IosConfiguration(
      autoStart: true,
      onForeground: onStart,
      onBackground: onIosBackground,
    ),
  );
}

@pragma('vm:entry-point')
bool onIosBackground(ServiceInstance service) {
  DartPluginRegistrant.ensureInitialized();
  return true;
}

@pragma('vm:entry-point')
void onStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  
  // Log de arranque de isolate (SRE telemetry)
  // ignore: avoid_print
  print('[SYS] Background Isolate onStart — Iniciando motor de tracking');

  if (service is AndroidServiceInstance) {
    service.on('setAsForeground').listen((_) => service.setAsForegroundService());
    service.on('setAsBackground').listen((_) => service.setAsBackgroundService());
  }

  // FIX C2: inicialización explícita sin `late` peligroso
  final api = ApiService();
  final storage = LocalStorage();

  // FIX C1 + C2: estado en instancia de clase, no en globales
  _engine = TrackingEngine(api: api, storage: storage);
  await _engine!.start(service);

  // FIX C3: parada limpia con cancelación de todos los recursos
  service.on('stopService').listen((_) {
    _log('SYS', 'stopService recibido — deteniendo motor...');
    _engine?.stop();
    _engine = null;
    service.stopSelf();
  });
}
