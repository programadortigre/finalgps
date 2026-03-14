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

// --- ESTRUCTURA DE LOGS PROFESIONAL ---
void _log(String tag, String message) {
  print('[$tag] $message');
}

enum TrackingState { STOPPED, DEEP_SLEEP, WALKING, DRIVING, BATT_SAVER, NO_SIGNAL }

// Global references para el isolate en segundo plano
TrackingState _currentState = TrackingState.STOPPED;
DateTime _lastValidLocationTime = DateTime.now();
LocalPoint? _lastValidPoint;
int _stationaryTicks = 0;
StreamSubscription<Position>? _positionStreamSub;
StreamSubscription<ar.Activity>? _activityStreamSub;

late ApiService _api;
late LocalStorage _storage;
LocationKalmanFilter? _locationFilter;

final Battery _battery = Battery();

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

  if (service is AndroidServiceInstance) {
    service.on('setAsForeground').listen((_) => service.setAsForegroundService());
    service.on('setAsBackground').listen((_) => service.setAsBackgroundService());
  }
  
  _api = ApiService();
  _storage = LocalStorage();
  
  try {
    WakelockPlus.enable();
  } catch (e) {
    _log('SYS', 'Wakelock init error: $e');
  }

  // 1. INICIAR SENSORES DE ACTIVIDAD (Activity Recognition)
  _initActivityRecognition();

  // 2. INICIAR STREAM DE UBICACIÓN
  _startLocationStream(service);

  // 3. START WATCHDOG / HEARTBEAT (Cada 60s)
  Timer.periodic(const Duration(seconds: 60), (timer) {
      _checkWatchdog(service);
  });

  // 4. BATCH UPLOADER (Cada 30s manda a la API)
  Timer.periodic(const Duration(seconds: 30), (timer) {
      _flushPoints();
  });

  // 5. EVENT STREAM EMITTER AL UI FRONTEND (SSOT)
  Timer.periodic(const Duration(seconds: 5), (timer) {
      service.invoke('trackingState', {
          'is_active': true,
          'state': _currentState.name,
      });
  });

  service.on('stopService').listen((_) {
    _log('SYS', 'Stopping tracking service...');
    _positionStreamSub?.cancel();
    _activityStreamSub?.cancel();
    try { WakelockPlus.disable(); } catch (_) {}
    service.stopSelf();
  });
}

void _initActivityRecognition() async {
  try {
    var status = await Permission.activityRecognition.status;
    if (status.isDenied) {
      status = await Permission.activityRecognition.request();
    }
    
    if (status.isGranted) {
      final activityRecognition = ar.FlutterActivityRecognition.instance;
      _activityStreamSub = activityRecognition.activityStream.listen((activity) {
        _log('ACTIVITY', 'Nativo detecta: ${activity.type.name} (Confianza: ${activity.confidence})');
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
  if (type == ar.ActivityType.IN_VEHICLE) newState = TrackingState.DRIVING;
  else if (type == ar.ActivityType.WALKING || type == ar.ActivityType.RUNNING || type == ar.ActivityType.ON_BICYCLE) newState = TrackingState.WALKING;
  else if (type == ar.ActivityType.STILL) {
    // Si la actividad física pura da STILL, mantenemos el voto dividido con GPS Speed antes de congelar a STOPPED.
  }

  if (newState != _currentState && (newState == TrackingState.DRIVING || newState == TrackingState.WALKING)) {
    // 🔔 DESPERTADOR INMEDIATO DEL ACELERÓMETRO
    if (_currentState == TrackingState.DEEP_SLEEP || _currentState == TrackingState.STOPPED) {
      _log('STATE', 'Wakeup Inmediato por Acelerómetro: ${newState.name}');
      _currentState = newState;
      _restartLocationStream(); 
    }
  }
}

void _checkWatchdog(ServiceInstance service) async {
  final now = DateTime.now();
  final diff = now.difference(_lastValidLocationTime).inSeconds;
  
  // 1. CHEQUEO DE BATERÍA MODO AHORRO
  try {
    final level = await _battery.batteryLevel;
    if (level < 15 && _currentState != TrackingState.BATT_SAVER) {
      _log('STATE', 'Batería Crítica < 15%. Forzando modo BATT_SAVER');
      _currentState = TrackingState.BATT_SAVER;
      _restartLocationStream();
      return;
    } else if (level >= 15 && _currentState == TrackingState.BATT_SAVER) {
      _currentState = TrackingState.STOPPED;
      _restartLocationStream();
    }
  } catch (e) {
    _log('BATT', 'Sensor batería falló: $e');
  }

  if (_currentState == TrackingState.BATT_SAVER) return;

  // 2. EXTREME DEEP SLEEP (Apaga receptor si estamos >10 minutos sin movimiento)
  if (_currentState == TrackingState.STOPPED && diff > 600) {
    _log('STATE', 'Inmóvil por >10min. Pasando a DEEP_SLEEP extremo');
    _currentState = TrackingState.DEEP_SLEEP;
    _restartLocationStream();
    return;
  }

  // 3. WATCHDOG: MUERTE DE SEÑAL / SUBTERRÁNEO
  if (diff > 120 && _currentState != TrackingState.DEEP_SLEEP) {
    _log('WATCHDOG', 'Timeout GPS. Sin lectura por ${diff}s. Posible túnel o crash OS. Reiniciando listener.');
    _currentState = TrackingState.NO_SIGNAL;
    _restartLocationStream();
  }
}

// Variables temporales para el filtro anti-congelamiento duplicado
int _duplicatePointCount = 0;
double _lastRawLat = 0;
double _lastRawLng = 0;

void _startLocationStream([ServiceInstance? service]) {
  _positionStreamSub?.cancel();

  // ── GPS ADAPTATIVO: PARAMETRIZACIÓN ──
  int intervalSec = 5;
  int distanceFilter = 5;
  LocationAccuracy accuracy = LocationAccuracy.bestForNavigation;

  switch (_currentState) {
    case TrackingState.DEEP_SLEEP:
    case TrackingState.BATT_SAVER:
      intervalSec = 300; // 1 punto cada 5 mins
      distanceFilter = 50;
      accuracy = LocationAccuracy.low;
      break;
    case TrackingState.STOPPED:
      intervalSec = 120; // 1 punto cada 2 mins
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

  _log('GPS', 'Stream Configurado -> State: ${_currentState.name} | Int: ${intervalSec}s | Dist: ${distanceFilter}m | Acc: ${accuracy.name}');

  _positionStreamSub = Geolocator.getPositionStream(
    locationSettings: AndroidSettings(
      accuracy: accuracy,
      distanceFilter: distanceFilter,
      intervalDuration: Duration(seconds: intervalSec),
      forceLocationManager: false,
      foregroundNotificationConfig: ForegroundNotificationConfig(
        notificationText: "Monitoreando: ${_currentState.name}",
        notificationTitle: "GPS Activo",
        enableWakeLock: _currentState != TrackingState.DEEP_SLEEP,
      ),
    ),
  ).listen((Position pos) async {
    _processNewPosition(pos, service);
  }, onError: (e) {
    _log('GPS', 'Error fatal de OS Stream: $e');
    // Backoff and retry
    Future.delayed(const Duration(seconds: 15), () => _restartLocationStream());
  });
}

void _restartLocationStream() {
  _startLocationStream(); // Se adapta orgánicamente al _currentState actual
}

void _processNewPosition(Position pos, [ServiceInstance? service]) async {
  try {
    final double speedKmh = pos.speed * 3.6;
    
    // 🦠 1. WATCHDOG FÍSICO: DETECCIÓN DE HARDWARE GPS CONGELADO (CACHÉ LOOP)
    if (pos.latitude == _lastRawLat && pos.longitude == _lastRawLng) {
       _duplicatePointCount++;
       if (_duplicatePointCount >= 10) {
           _log('WATCHDOG', 'Hardware GPS en loop cerrado (misma lat/lng 10 veces). Ejecutando purga e interrupción.');
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

    // 🤖 2. VOTACIÓN HÍBRIDA DE ESTADO CON VELOCIDAD (Complementando ActivitySensor)
    if (_currentState != TrackingState.DEEP_SLEEP && _currentState != TrackingState.BATT_SAVER) {
      TrackingState votedState = _currentState;
      if (speedKmh > 12.0) votedState = TrackingState.DRIVING;
      else if (speedKmh > 2.0 && speedKmh <= 12.0) votedState = TrackingState.WALKING;
      else if (speedKmh <= 2.0) {
         _stationaryTicks++;
         if (_stationaryTicks > 8) votedState = TrackingState.STOPPED;
      }

      if (speedKmh > 2.0) _stationaryTicks = 0;

      if (votedState != _currentState) {
         _log('STATE', '${_currentState.name} -> ${votedState.name} (Por validación híbrida V=${speedKmh.toStringAsFixed(1)})');
         _currentState = votedState;
         _restartLocationStream(); 
         return; // Process next en el nuevo hilo
      }
    }

    // 🔬 3. PIPELINE DE FILTRADO TIER 1 
    double distToLast = 0.0;
    if (_lastValidPoint != null) {
      distToLast = Geolocator.distanceBetween(_lastValidPoint!.lat, _lastValidPoint!.lng, pos.latitude, pos.longitude);
      
      // Filtro 3A: Precisión Dinámica Flex (D > Acc*0.5)
      if (pos.accuracy > 30) {
         if (distToLast < (pos.accuracy * 0.5)) {
             _log('FILTER', 'DROP - Distancia injustificada (${distToLast.toStringAsFixed(1)}m) para pobre precisión (${pos.accuracy}m)');
             return;
         }
      }
    } else if (pos.accuracy > 40) {
       _log('FILTER', 'DROP - Primer punto con terrible precisión: ${pos.accuracy}m');
       return;
    }

    // Filtro 3B: Velocidad Estática Brutal
    if (speedKmh > 200) {
       _log('FILTER', 'DROP - Velocidad incoherente: $speedKmh km/h');
       return;
    }
    
    // Filtro 3C: Aceleración Cósmica Imposible Δv/Δt
    if (_lastValidPoint != null) {
       double timeSecs = (DateTime.now().millisecondsSinceEpoch - _lastValidPoint!.timestamp) / 1000.0;
       if (timeSecs > 0) {
           double avgSpeed = (distToLast / timeSecs) * 3.6;
           // Ej: No se permiten saltos donde el promedio supera exageradamente rápido
           if (avgSpeed > 180) {
               _log('FILTER', 'DROP - Salto telepórtico / Aceleración física imposible: ${avgSpeed.toStringAsFixed(0)} km/h');
               return;
           }
       }
    }

    // Filtro 3D: Ruido Inercial Distancia
    if (_currentState == TrackingState.DRIVING && distToLast > 0 && distToLast < 4) {
       _log('FILTER', 'DROP - Micro-paso inercial ignorado en conducción: ${distToLast.toStringAsFixed(1)}m');
       return; 
    }

    // 🧮 4. FILTRO KALMAN MATEMÁTICO 
    _locationFilter ??= LocationKalmanFilter(initialLat: pos.latitude, initialLng: pos.longitude, gpsAccuracy: pos.accuracy);
    final filtered = _locationFilter!.update(pos.latitude, pos.longitude, gpsAccuracy: pos.accuracy);
    double finalLat = filtered['lat']!;
    double finalLng = filtered['lng']!;

    // ⚓ 5. FILTRO ANTI-DRIFT 
    if (_currentState == TrackingState.STOPPED && _lastValidPoint != null) {
        double driftDist = Geolocator.distanceBetween(_lastValidPoint!.lat, _lastValidPoint!.lng, finalLat, finalLng);
        if (driftDist < 15) {
            _log('FILTER', 'DROP - Anclado Anti-Drift: Movimiento ${driftDist.toStringAsFixed(1)}m descartado');
            return; 
        }
    }

    // 🚫 6. DEDUPLICACIÓN PRE-SQLITE
    if (_lastValidPoint != null && _lastValidPoint!.lat == finalLat && _lastValidPoint!.lng == finalLng) {
        return; // Exact duplicate
    }

    final userIdStr = await _api.getUserId();
    final employeeId = int.tryParse(userIdStr ?? '');
    if (employeeId == null) return;

    final point = LocalPoint(
      lat: finalLat,
      lng: finalLng,
      speed: speedKmh,
      accuracy: pos.accuracy,
      state: _currentState.name,
      timestamp: DateTime.now().millisecondsSinceEpoch,
      employeeId: employeeId,
    );

    // 💾 Persistencia Segura c/Backpressure Handling (5000 max en SQLite)
    await _storage.insertPoint(point);
    _lastValidPoint = point;

    // 📱 Actualizar Frontend vía SSOT Emisor
    if (service != null && service is AndroidServiceInstance) {
       service.invoke('trackingLocation', {
          'lat': finalLat,
          'lng': finalLng,
          'speed': speedKmh,
          'accuracy': pos.accuracy,
          'state': _currentState.name,
       });

       try {
         if (await service.isForegroundService()) {
            final stats = await _storage.getStats();
            final count = stats['unsynced'] ?? 0;
            service.setForegroundNotificationInfo(
               title: 'Rastreo: ${_currentState.name} (${pos.accuracy.toStringAsFixed(1)}m)',
               content: 'Vel: ${speedKmh.toStringAsFixed(1)} km/h | Cola: $count uds',
            );
         }
       } catch (e) { }  // Fallos del notificador no deben tumbar el pipe
    }
  } catch (e, stack) {
    _log('CRITICAL', 'Fallo de procesamiento interno: $e \n $stack');
  }
}

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
      'state': p.state, // Se manda el string real "DRIVING", "DEEP_SLEEP", etc.
      'timestamp': p.timestamp,
    }).toList();

    _log('BATCH', 'Preparando transmisión: ${data.length} puntos...');
    final ok = await _api.uploadBatch(data);
    if (ok) {
      final ids = unsyncedPoints.map((p) => p.id!).toList();
      await _storage.markPointsAsSynced(ids);
      _log('BATCH', 'Éxito. ${ids.length} puntos limpiados de cola.');
    }
  } catch (e) {
    _log('BATCH', 'Error red/batching: $e');
  }
}
