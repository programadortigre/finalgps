import 'dart:async';
import 'dart:ui';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:geolocator/geolocator.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_activity_recognition/flutter_activity_recognition.dart' as ar;
import 'api_service.dart';
import 'local_storage.dart';
import '../models/local_point.dart';
import '../utils/kalman_filter.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'socket_service.dart';

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
  NO_SIGNAL,
  PAUSED // ✅ Remotely disabled by admin
}

// ---------------------------------------------------------------------------
// TrackingEngine — TODA la lógica de estado en una clase instanciada.
// Evita el anti-patrón de variables globales que se reinician al crash del OS.
// ---------------------------------------------------------------------------
class TrackingEngine {
    // Declaración adelantada para evitar errores de referencia

  // ── Dependencias ──────────────────────────────────────────────────────────
  final ApiService _api;
  final LocalStorage _storage;
  final Battery _battery = Battery();

  // ── Estado interno ─────────────────────────────────────────────────────────
  TrackingState _currentState = TrackingState.STOPPED;
  DateTime _lastValidLocationTime = DateTime.now();
  LocalPoint? _lastValidPoint;
  int _duplicatePointCount = 0;
  double _lastRawLat = 0;
  double _lastRawLng = 0;
  LocationKalmanFilter? _locationFilter;
  double _totalDistanceKm = 0.0; // Source of Truth for distance

  // PRO: Buffering & Caching
  final List<LocalPoint> _pointBuffer = [];
  String? _cachedToken;
  int? _cachedEmployeeId;

   // PRO: Hysteresis & Filtering
  DateTime _lastStateChangeTime = DateTime.now();
  int _lowSpeedTicks = 0;  // Para WALKING -> STOPPED (< 0.8 m/s)
  int _highSpeedTicks = 0; // Para STOPPED -> WALKING (> 1.2 m/s)
  int _stationaryTicks = 0; // Para compatibilidad y filtrado fino

  // Socket status cache
  bool _isSocketConnectedByAdmin = true;

  // FIX C5: guardamos la referencia al ServiceInstance para siempre estar disponible
  ServiceInstance? _serviceInstance;
  io.Socket? _socket;

  // ── Subscripciones ─────────────────────────────────────────────────────────
  StreamSubscription<Position>? _positionStreamSub;
  StreamSubscription<ar.Activity>? _activityStreamSub;

  // PRO: Unified Maintenance Timer
  Timer? _mainMaintenanceTimer;
  int _maintenanceTicks = 0;
  int _retryBackoffSeconds = 0;

  // FIX V3: Guard para evitar subidas paralelas
  bool _isFlushing = false;

  // FIX DEEP-AUDIT: Guard para evitar solapamiento de procesamiento GPS
  bool _isProcessingPosition = false;

  // FIX DEEP-AUDIT: Guard para evitar reinicios de stream concurrentes
  bool _isRestartingStream = false;
  bool _isSleepModeActive = false;
  bool _isPriorityScanActive = false;
  int _priorityScanTicks = 0;

  // FIX LIVE: Guardar si el admin pidió ubicación mientras offline
  bool _pendingLocationRequest = false;

  // FIX V3: Timestamp del último punto RAW de GPS para el Watchdog
  DateTime _lastRawTime = DateTime.now();

  static const int _cleanupIntervalTicks = 1440; // 1440 × 60s = 24 horas

  // ── Constructor: inicialización segura (sin `late`) ───────────────────────
  TrackingEngine({required ApiService api, required LocalStorage storage})
      : _api = api,
        _storage = storage;

  // ---------------------------------------------------------------------------
  // Arranque del motor
  // ---------------------------------------------------------------------------
  Future<void> start(ServiceInstance service) async {
    _log('ISOLATE', '>>> engine.start() [ENTER]');
    try {
      _serviceInstance = service;

      // Wake lock solo cuando sea necesario (ver _applyWakelock)
      _applyWakelock();

      // 1. Activity Recognition
      _log('INIT', 'Iniciando Activity Recognition...');
      await _initActivityRecognition();

      // 2. Stream GPS
      _log('INIT', 'Iniciando Stream GPS...');
      _startLocationStream(reason: 'Initial Start');

      // PRO: Unified Maintenance Loop (60s)
      _mainMaintenanceTimer = Timer.periodic(const Duration(seconds: 60), (_) {
        try {
          _runMaintenanceTasks();
        } catch (e) {
          _log('CRITICAL', 'Fallo en Main Maintenance Timer: $e');
        }
      });

      // FIX 1: Reinicio limpio de distancia al iniciar
      _totalDistanceKm = 0;
      _lastValidPoint = null;
      _pointBuffer.clear();

      // FIX DEEP-AUDIT: Posponemos SecureStorage e hidratación de DB para DESPUÉS del arranque básico
      // Esto asegura que el servicio ya esté en primer plano y los timers corriendo.
      _log('INIT', 'Iniciando carga asíncrona de estado (SecureStorage/DB)...');
      _deferredInitialization();

      _log('ISOLATE', '<<< engine.start() [DONE]');
    } catch (e, stack) {
      _log('CRITICAL', 'Error fatal en engine.start(): $e\n$stack');
    }
  }

  // Inicialización diferida para evitar bloquear el arranque del isolate
  Future<void> _deferredInitialization() async {
    _log('INIT', '>>> _deferredInitialization() [ENTER]');
    try {
      // PRO: Cachear token y employeeId de inmediato
      _cachedToken = await _api.getToken();
      await _loadCachedEmployeeId();
      await _restoreStateFromStorage();

      // ✅ NUEVO: Verificar estado de rastreo en el servidor
      final profile = await _api.fetchMyProfile();
      if (profile != null) {
        final bool isTrackingEnabled = profile['is_tracking_enabled'] ?? true;
        _log('INIT', 'Sincronización remota: is_tracking_enabled=$isTrackingEnabled');
        if (!isTrackingEnabled) {
          _log('INIT', 'Rastreo desactivado remotamente. Entrando en PAUSED.');
          pause();
        }
      }

      _log('INIT', '<<< _deferredInitialization() [DONE]');
    } catch (e) {
      _log('INIT', '!!! _deferredInitialization() [ERROR]: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Parada limpia del motor
  // ---------------------------------------------------------------------------
  void stop() {
    _log('SYS', 'TrackingEngine.stop() — cancelando todos los recursos');

    _mainMaintenanceTimer?.cancel();
    _positionStreamSub?.cancel();
    _activityStreamSub?.cancel();

    // PRO: Guardar puntos pendientes antes de morir
    _flushBufferToStorage();

    _totalDistanceKm = 0;
    _lastValidPoint = null;
    _pointBuffer.clear();

    _serviceInstance?.invoke('trackingState', {
      'is_active': false,
      'state': 'STOPPED',
    });
  }

  // ── PAUSE / RESUME (Battery Saver) ────────────────────────────────────────
  void pause() {
    _log('REMOTE', 'Pausando rastreo (GPS OFF, Socket ON)...');
    _positionStreamSub?.cancel();
    _activityStreamSub?.cancel();
    _mainMaintenanceTimer?.cancel();
    _currentState = TrackingState.PAUSED;
    
    // Guardar buffer antes de pausar
    _flushBufferToStorage();

    _serviceInstance?.invoke('trackingState', {
      'is_active': true,
      'state': 'PAUSED',
    });

    if (_serviceInstance is AndroidServiceInstance) {
      (_serviceInstance as AndroidServiceInstance).setForegroundNotificationInfo(
        title: 'Rastreo Pausado ⏸️',
        content: 'El administrador ha desactivado el rastreo (Bajo Consumo).',
      );
    }
  }

  void resume() {
    if (_currentState != TrackingState.PAUSED) return;
    _log('REMOTE', 'Reanudando rastreo por comando remoto...');
    _currentState = TrackingState.STOPPED;
    _startLocationStream(reason: 'Remote Resume');
    
    // Reiniciar loop de mantenimiento
    _mainMaintenanceTimer?.cancel();
    _mainMaintenanceTimer = Timer.periodic(const Duration(seconds: 60), (_) => _runMaintenanceTasks());
  }

  void updateSocketStatus(bool connected) {
    _isSocketConnectedByAdmin = connected;
    _updateNotification();
  }

  void setSocket(io.Socket socket) {
    _socket = socket;
  }

  void handleRemoteLocationRequest() {
    _log('SOCKET', 'ADMIN: Petición de ubicación en tiempo real recibida');
    _isPriorityScanActive = true;
    _priorityScanTicks = 0;

    // Si el socket está offline, encolar la petición para enviar al reconectar
    if (_socket == null || !_socket!.connected) {
      _log('SOCKET', 'Socket offline — petición encolada, se enviará al reconectar');
      _pendingLocationRequest = true;
      // Intentar obtener GPS de todas formas (para tenerlo listo)
      Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 10),
      ).then((pos) {
        _lastValidPoint = LocalPoint(
          lat: pos.latitude,
          lng: pos.longitude,
          speed: pos.speed * 3.6,
          accuracy: pos.accuracy,
          state: _currentState.name,
          timestamp: DateTime.now().millisecondsSinceEpoch,
          employeeId: _cachedEmployeeId,
        );
        _log('SOCKET', 'GPS obtenido offline: ${pos.latitude}, ${pos.longitude} (acc: ${pos.accuracy}m)');
      }).catchError((e) {
        _log('SOCKET', 'GPS offline falló: $e');
      });
      return;
    }

    // 1. Intentar obtener una ubicación actual
    Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.best, timeLimit: const Duration(seconds: 8))
        .then((pos) {
      final point = LocalPoint(
        lat: pos.latitude,
        lng: pos.longitude,
        speed: pos.speed * 3.6, // m/s a km/h
        accuracy: pos.accuracy,
        state: _currentState.name,
        timestamp: DateTime.now().millisecondsSinceEpoch,
        employeeId: _cachedEmployeeId,
      );
      _emitToSocket(point);
      _lastValidPoint = point;
    }).catchError((e) {
      _log('SOCKET', 'Error obteniendo ubicación actual: $e');
      // Si falla, enviar último punto conocido
      if (_lastValidPoint != null) {
        _emitToSocket(_lastValidPoint!);
      }
    });

    // 2. Forzar escaneo de ALTA PRECISIÓN
    _restartLocationStream(reason: 'Admin Remote Request (Priority)');
  }

  // Llamar cuando el socket reconecta — envía ubicación pendiente al admin
  void onSocketReconnected() {
    _log('SOCKET', 'Socket reconectado');
    _updateNotification();
    if (_pendingLocationRequest && _lastValidPoint != null) {
      _log('SOCKET', 'Enviando ubicación pendiente al admin (guardada offline)');
      _emitToSocket(_lastValidPoint!);
      _pendingLocationRequest = false;
    }
  }

  void _emitToSocket(LocalPoint point) {
    if (_socket == null || !_socket!.connected) return;
    try {
      _socket!.emit('location_update', {
        'lat': point.lat,
        'lng': point.lng,
        'speed': point.speed,
        'accuracy': point.accuracy,
        'state': point.state,
        'timestamp': point.timestamp,
        'is_manual_request': true,
      });
      _log('SOCKET', 'Punto enviado a socket (Real-time)');
    } catch (e) {
      _log('SOCKET', 'Error emitiendo a socket: $e');
    }
  }

  void _updateNotification() async {
    final svc = _serviceInstance;
    if (svc == null || svc is! AndroidServiceInstance) return;
    if (!(await svc.isForegroundService())) return;

    String title;
    String content;

    if (_currentState == TrackingState.PAUSED) {
      title = 'Rastreo Pausado 📶';
      content = 'Control remoto activo · Esperando señal del Admin';
    } else {
      final stats = await _storage.getStats();
      final count = stats['unsynced'] ?? 0;
      final status = _isSocketConnectedByAdmin ? '📡' : '🚫';
      title = 'Rastreo: ${_currentState.name} $status';
      content = 'Cola: $count pts | Control Remoto: ${_isSocketConnectedByAdmin ? "Conectado" : "Buscando..."}';
    }

    svc.setForegroundNotificationInfo(title: title, content: content);
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

  // FIX A2: Wake Lock se mantiene automáticamente por flutter_background_service
  // El servicio de foreground mantiene la CPU despierta, no es necesario wakelock_plus
  void _applyWakelock() {
    // Wakelock management moved to foreground service
    // No action needed here
  }

  // ---------------------------------------------------------------------------
  // Activity Recognition
  // ---------------------------------------------------------------------------
  Future<void> _initActivityRecognition() async {
    try {
      final status = await Permission.activityRecognition.status;
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
  // Loop de Mantenimiento Unificado (60s)
  // ---------------------------------------------------------------------------
  Future<void> _runMaintenanceTasks() async {
    _maintenanceTicks++;
    _log('MAIN', 'Loop #$_maintenanceTicks [ENTER]');

    try {
      // 1. Throttling por Batería
      await _updateBatteryAndThrottling();

      // 2. Flush de Buffer a SQLite
      await _flushBufferToStorage();

      // 3. Flush de SQLite a API (Solo si bat > 10%)
      final level = await _battery.batteryLevel;
      if (level > 10) {
        await _flushStorageToApi();
      }

      // 4. Priority Scan Watchdog
      if (_isPriorityScanActive) {
        _priorityScanTicks++;
        if (_priorityScanTicks >= 5) {
          _log('GPS', 'Finalizando prioridad de escaneo (Timeout 5m)');
          _isPriorityScanActive = false;
          _restartLocationStream(reason: 'End Priority Scan');
        }
      }

      // 5. Emitter al UI (Menos frecuente para ahorrar CPU)
      _serviceInstance?.invoke('trackingState', {
        'is_active': true,
        'state': _currentState.name,
      });

      // 5. Watchdog de Salud (GPS/Túneles)
      _checkWatchdogHealth();
      
      // 6. Limpieza periódica (24h)
      if (_maintenanceTicks >= 1440) {
        _maintenanceTicks = 0;
        _storage.cleanOldSyncedPoints(daysToKeep: 7);
      }
    } catch (e) {
      _log('CRITICAL', 'Error en _runMaintenanceTasks: $e');
    }
    _log('MAIN', 'Loop #$_maintenanceTicks [DONE]');
  }

  Future<void> _updateBatteryAndThrottling() async {
    try {
      final level = await _battery.batteryLevel;
      if (level < 20 && _currentState != TrackingState.BATT_SAVER && _currentState != TrackingState.PAUSED) {
        _setState(TrackingState.BATT_SAVER, reason: 'Power Savings (<20%)');
      } else if (level >= 30 && _currentState == TrackingState.BATT_SAVER) {
        _setState(TrackingState.STOPPED, reason: 'Battery recovered');
      }
    } catch (e) {
      _log('BATT', 'Sensor falló: $e');
    }
  }

  void _checkWatchdogHealth() {
    final now = DateTime.now();
    final diff = now.difference(_lastValidLocationTime).inSeconds;
    
    // GPS Watchdog: si estamos en movimiento pero no recibimos nada por 30s
    final rawDiff = now.difference(_lastRawTime).inSeconds;
    if (rawDiff > 30 && _currentState != TrackingState.DEEP_SLEEP && _currentState != TrackingState.STOPPED && _currentState != TrackingState.PAUSED) {
      _log('WATCHDOG', 'Reiniciando stream: ${rawDiff}s sin datos GPS');
      _lastRawTime = now;
      _restartLocationStream(reason: 'Watchdog Timeout');
    }

    // Deep Sleep: inactivo >3 min (Sleep Mode)
    if (_currentState == TrackingState.STOPPED && diff > 180) {
      _setState(TrackingState.DEEP_SLEEP, reason: 'Inactivity 3m (Sleep Mode)');
      return;
    }

    // Refresh settings for Light Sleep (60s mark) 
    if (_currentState == TrackingState.STOPPED && diff > 60 && !_isSleepModeActive) {
      _log('WATCHDOG', 'Activando Light Sleep Mode (Inactividad >60s)');
      _restartLocationStream(reason: 'Light Sleep Transition');
    }

    // No Signal: >5 min sin puntos válidos en estados de movimiento
    if (diff > 300 && _currentState != TrackingState.DEEP_SLEEP && _currentState != TrackingState.STOPPED && _currentState != TrackingState.PAUSED) {
      _setState(TrackingState.NO_SIGNAL, reason: 'No valid signal 5m');
    }
  }

  // ---------------------------------------------------------------------------
  // Gestión de Estado y Stream GPS
  // ---------------------------------------------------------------------------
  void _setState(TrackingState newState, {String? reason}) {
    if (newState == _currentState) return;
    _log('STATE', '${_currentState.name} → ${newState.name} ${reason != null ? "($reason)" : ""}');
    _currentState = newState;
    _lastStateChangeTime = DateTime.now();
    _isSleepModeActive = false; // Reset sleep mode on any real state change
    
    _applyWakelock();
    _restartLocationStream(reason: reason ?? 'State Change');
  }

  Future<void> _startLocationStream({String? reason}) async {
    if (_isRestartingStream) return;
    if (_currentState == TrackingState.PAUSED) return;
    _isRestartingStream = true;

    try {
      _positionStreamSub?.cancel();

      int intervalSec;
      int distanceFilter;
      LocationAccuracy accuracy;

      // 0. Priority Scan Override (Admin Request)
      if (_isPriorityScanActive) {
        intervalSec = 2; // Máxima frecuencia
        distanceFilter = 0; // Sin filtro
        accuracy = LocationAccuracy.best;
        _log('GPS', 'PRIORITY SCAN ACTIVE: Settings set to MAX');
      } else {
        // 1. Valores por defecto según estado
        switch (_currentState) {
        case TrackingState.STOPPED:
          final secondsStationary = DateTime.now().difference(_lastStateChangeTime).inSeconds;
          if (secondsStationary > 60) {
            _isSleepModeActive = true;
            // Light Sleep Mode (WhatsApp style)
            intervalSec = 60;
            distanceFilter = 15;
            accuracy = LocationAccuracy.low;
            _log('GPS', 'SLEEP MODE: Light Inactivity ($secondsStationary s)');
          } else {
            _isSleepModeActive = false;
            intervalSec = 15;
            distanceFilter = 5;
            accuracy = LocationAccuracy.medium;
          }
          break;
        case TrackingState.DEEP_SLEEP:
          // FIX: 90s en vez de 5 min — si el usuario vuelve a caminar,
          // la app lo detecta en máx. 90s y no en 10+ minutos.
          // LocationAccuracy.low usa antenas de celular, consume muy poca batería.
          intervalSec = 90;
          distanceFilter = 20;
          accuracy = LocationAccuracy.low;
          break;
        case TrackingState.BATT_SAVER:
          intervalSec = 60;
          distanceFilter = 30;
          accuracy = LocationAccuracy.medium;
          break;
        case TrackingState.WALKING:
          intervalSec = 5;
          distanceFilter = 5;
          accuracy = LocationAccuracy.high;
          break;
        case TrackingState.DRIVING:
        default:
          intervalSec = 3;
          distanceFilter = 10;
          accuracy = LocationAccuracy.best;
          break;
      }

      // 2. Overrides por Batería (Granular)
      final level = await _battery.batteryLevel;
      if (level < 30) {
        intervalSec = (level < 10) ? 120 : ((level < 20) ? 60 : 30);
        accuracy = (level < 10) ? LocationAccuracy.low : LocationAccuracy.medium;
        distanceFilter = (level < 10) ? 50 : 20;
        _log('GPS', 'BATTERY OVERRIDE ($level%): Interval=${intervalSec}s Accuracy=${accuracy.name}');
      }
    }

      _log('GPS', 'Stream START ($reason) → ${_currentState.name} | ${intervalSec}s | ${distanceFilter}m');

      _positionStreamSub = Geolocator.getPositionStream(
        locationSettings: AndroidSettings(
          accuracy: accuracy,
          distanceFilter: distanceFilter,
          intervalDuration: Duration(seconds: intervalSec),
          forceLocationManager: false,
        ),
      ).listen(
        (Position pos) {
          _lastRawTime = DateTime.now();
          _processNewPosition(pos);
        },
        onError: (e) {
          _log('GPS', 'Error en stream: $e');
          _restartLocationStream(reason: 'Stream Error');
        },
      );
    } catch (e) {
      _log('GPS', 'Error iniciando stream: $e');
    } finally {
      _isRestartingStream = false;
    }
  }

  void _restartLocationStream({String? reason}) => _startLocationStream(reason: reason);

  // ---------------------------------------------------------------------------
  // Procesamiento GPS y Hysteresis
  // ---------------------------------------------------------------------------
  Future<void> _processNewPosition(Position pos) async {
    if (_isProcessingPosition) return;
    _isProcessingPosition = true;

    try {
      final double speed = pos.speed; // m/s
      final double speedKmh = speed * 3.6;

      // FILTRO 1: Descartar por baja precisión
      if (pos.accuracy > 20) {
        _log('GPS', 'Descartado por baja precisión: ${pos.accuracy}m');
        _isProcessingPosition = false;
        return;
      }

      // FILTRO 2: Descartar saltos imposibles
      if (_lastValidPoint != null) {
        final dist = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng,
          pos.latitude, pos.longitude,
        );
        if (dist > 50 && speedKmh < 20) {
          _log('GPS', 'Salto descartado: $dist m, velocidad: $speedKmh km/h');
          _isProcessingPosition = false;
          return;
        }
        // Drift detectado: < 8m y < 1 m/s
        if (dist < 8 && speed < 1.0 && _currentState == TrackingState.STOPPED) {
          _isProcessingPosition = false;
          return;
        }
      }

      // 2. Hysteresis de Estado (Debouncing de transiciones)
      final secondsInCurrentState = DateTime.now().difference(_lastStateChangeTime).inSeconds;
      TrackingState targetState = _currentState;

      if (_currentState == TrackingState.WALKING) {
        if (speed < 0.8) {
          // Permanecer en WALKING hasta que estemos quietos por 20s
          if (secondsInCurrentState > 20) targetState = TrackingState.STOPPED;
        } else {
          // Resetear tiempo de cambio si hay movimiento real
          if (speed > 1.0) _lastStateChangeTime = DateTime.now();
          if (speedKmh > 15) targetState = TrackingState.DRIVING;
        }
      } else if (_currentState == TrackingState.STOPPED || _currentState == TrackingState.DEEP_SLEEP) {
        final distFromLast = _lastValidPoint != null 
            ? Geolocator.distanceBetween(_lastValidPoint!.lat, _lastValidPoint!.lng, pos.latitude, pos.longitude)
            : 0.0;

        // FIX: En DEEP_SLEEP despertamos con UNA sola lectura de movimiento
        // (antes necesitaba 2, a 90s de intervalo = 3 min de delay mínimo).
        // Si hay falsas alarmas, el filtro de velocidad de Kalman las filtra.
        if (speed > 1.0 || distFromLast > 12.0) {
          _highSpeedTicks++;
          final requiredTicks = (_currentState == TrackingState.DEEP_SLEEP) ? 1 : 2;
          if (_highSpeedTicks >= requiredTicks) targetState = TrackingState.WALKING;
        } else {
          _highSpeedTicks = 0;
          if (pos.accuracy < 25) _lastStateChangeTime = DateTime.now().subtract(Duration(seconds: secondsInCurrentState));
        }
      } else if (_currentState == TrackingState.DRIVING) {
        if (speedKmh < 10) {
          if (secondsInCurrentState > 30) targetState = TrackingState.WALKING;
        } else {
          if (speedKmh > 15) _lastStateChangeTime = DateTime.now();
        }
      }

      if (targetState != _currentState && _currentState != TrackingState.BATT_SAVER) {
        _log('STATE', 'Hysteresis -> $targetState (speed=${speed.toStringAsFixed(1)}m/s after ${secondsInCurrentState}s)');
        _setState(targetState, reason: 'Hysteresis');
        return; // Reiniciar stream para el nuevo estado
      }

      // 3. Filtrado de Calidad (Kalman)
      _locationFilter ??= LocationKalmanFilter(
        initialLat: pos.latitude,
        initialLng: pos.longitude,
        gpsAccuracy: pos.accuracy,
      );
      final filtered = _locationFilter!.update(
        pos.latitude, pos.longitude,
        gpsAccuracy: pos.accuracy,
        speedKmh: speedKmh,
      );

      // 4. Buffering en Memoria
      _lastValidLocationTime = DateTime.now();
      final point = LocalPoint(
        lat: filtered['lat']!,
        lng: filtered['lng']!,
        speed: speedKmh,
        accuracy: pos.accuracy,
        state: _currentState.name,
        timestamp: _lastValidLocationTime.millisecondsSinceEpoch,
        employeeId: _cachedEmployeeId,
      );

      _pointBuffer.add(point);
      
      // Enviar a socket inmediatamente si hay una petición prioritaria
      if (_isPriorityScanActive) {
        _emitToSocket(point);
        // Desactivar prioridad después de obtener un punto bueno? 
        // No, dejémoslo un par de minutos para que el admin vea el movimiento fluido.
      }

      // Actualizar distancia local para UI
      if (_lastValidPoint != null) {
        final d = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng,
          point.lat, point.lng
        );
        if (d > 5) _totalDistanceKm += (d / 1000.0);
      }
      _lastValidPoint = point;

      // Emitir al UI inmediatamente si es relevante
      _serviceInstance?.invoke('trackingLocation', {
        'lat': point.lat,
        'lng': point.lng,
        'speed': speedKmh,
        'state': _currentState.name,
        'total_distance': _totalDistanceKm,
      });

      _updateNotification();
    } catch (e) {
      _log('CRITICAL', 'Error procesando posición: $e');
    } finally {
      _isProcessingPosition = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Persistencia y Sincronización
  // ---------------------------------------------------------------------------
  Future<void> _flushBufferToStorage() async {
    if (_pointBuffer.isEmpty) return;
    _log('STORAGE', 'Guardando ${_pointBuffer.length} puntos en SQLite...');
    try {
      final pointsToSave = List<LocalPoint>.from(_pointBuffer);
      _pointBuffer.clear();
      await _storage.insertPoints(pointsToSave);
    } catch (e) {
      _log('STORAGE', 'Error guardando buffer: $e');
    }
  }

  Future<void> _flushStorageToApi() async {
    if (_isFlushing || _cachedToken == null) return;
    _isFlushing = true;

    try {
      final unsynced = await _storage.getUnsyncedPoints(limit: 50);
      if (unsynced.isEmpty) {
        _isFlushing = false;
        return;
      }

      // Aplicar backoff si hubo errores previos
      if (_retryBackoffSeconds > 0) {
        _retryBackoffSeconds--;
        _isFlushing = false;
        return;
      }

      final data = unsynced.map((p) => {
        'lat': p.lat, 'lng': p.lng,
        'speed': p.speed, 'accuracy': p.accuracy,
        'state': p.state, 'timestamp': p.timestamp,
      }).toList();

      _log('API', 'Enviando batch de ${data.length} puntos...');
      final ok = await _api.uploadBatch(data);
      
      if (ok) {
        final ids = unsynced.map((p) => p.id!).toList();
        await _storage.markPointsAsSynced(ids);
        _log('API', 'Batch enviado con éxito');
        _retryBackoffSeconds = 0;
      } else {
        // Backoff exponencial simple: 1 min, 2 min, 4 min...
        _retryBackoffSeconds = 60; 
        _log('API', 'Fallo en envío. Iniciando backoff.');
      }
    } catch (e) {
      _log('API', 'Error de red: $e');
      _retryBackoffSeconds = 60;
    } finally {
      _isFlushing = false;
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
      autoStart: false,  // Iniciar manualmente desde la pantalla de tracking
      isForegroundMode: true,
      notificationChannelId: 'gps_tracking_channel',
      initialNotificationTitle: 'GPS Tracker Pro',
      initialNotificationContent: 'Rastreando ubicación en tiempo real...',
      foregroundServiceNotificationId: 888,
    ),
    iosConfiguration: IosConfiguration(
      autoStart: false,
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
  // ⚠️ PASO CRÍTICO 1: Notificar a Android INMEDIATAMENTE (dentro de 5 segundos)
  if (service is AndroidServiceInstance) {
    service.setAsForegroundService();
    
    // ✅ CONFIGURAR NOTIFICACIÓN BÁSICA INMEDIATAMENTE
    service.setForegroundNotificationInfo(
      title: "GPS Tracker Pro",
      content: "Iniciando servicio de rastreo...",
    );
  }

  // AHORA sí, el resto de la inicialización (después de la notificación)
  DartPluginRegistrant.ensureInitialized();
  _log('ISOLATE', '>>> onStart() [ENTER]');

  try {
    final api = ApiService();
    final storage = LocalStorage();

    _engine = TrackingEngine(api: api, storage: storage);
    await _engine!.start(service);

    // ✅ NUEVO: Socket Listener en el Background Isolate
    final token = await api.getToken();
    if (token != null) {
      _log('SOCKET', 'Iniciando socket en segundo plano...');
      // Importamos dinámicamente si es necesario o usamos SocketService
      // Nota: SocketService debe ser compatible con Background Isolate
      // Para simplicidad, escuchamos el evento del main isolate si el app está abierta,
      // pero para robustez total, el socket debe estar AQUÍ.
      
      // Intentamos inicializar el socket del propio isolate
      try {
        final url = await ApiService.getServerUrl();
        final userId = await api.getUserId();
        
        final socket = io.io(url, io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .setQuery({'from_background': 'true'})
          .disableAutoConnect() // Control manual para mejor gestión
          .build());

        socket.onConnect((_) {
          _log('SOCKET', 'Socket conectado en segundo plano (Isolate)');
          _engine?.setSocket(socket); // Pasar socket al motor
          _engine?.updateSocketStatus(true);
          if (userId != null) socket.emit('join_employee', userId);
          // FIX LIVE: Si había una petición de ubicación pendiente mientras
          // el teléfono estaba sin datos, la enviamos ahora al reconectar.
          _engine?.onSocketReconnected();
        });

        socket.onDisconnect((_) {
          _log('SOCKET', 'Socket desconectado en segundo plano');
          _engine?.updateSocketStatus(false);
        });

        socket.onConnectError((e) {
            _log('SOCKET', 'Error de conexión socket bg: $e');
            _engine?.updateSocketStatus(false);
        });

        socket.on('remote_tracking_toggle', (data) {
          final bool enabled = data['enabled'] ?? false;
          _log('SOCKET', 'Comando remoto recibido: enabled=$enabled');
          if (enabled) {
            _engine?.resume();
          } else {
            _engine?.pause();
          }
        });

        socket.on('request_current_location', (data) {
          _log('SOCKET', 'Comando manual de ubicación recibido');
          _engine?.handleRemoteLocationRequest();
        });

        socket.connect();
      } catch(e) {
        _log('SOCKET', 'Error iniciando socket bg: $e');
      }
    }

    // Escuchar eventos del servicio
    if (service is AndroidServiceInstance) {
      service.on('setAsForeground').listen((_) => service.setAsForegroundService());
      service.on('setAsBackground').listen((_) => service.setAsBackgroundService());
    }

    service.on('stopService').listen((_) {
      _log('SYS', 'stopService recibido — deteniendo motor...');
      _engine?.stop();
      _engine = null;
      service.stopSelf();
    });
  } catch (e, stack) {
    _log('CRITICAL', 'Fallo letal en isolate onStart: $e\n$stack');
    rethrow;
  }
}
