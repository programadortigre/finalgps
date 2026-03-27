import 'dart:async';
import 'dart:ui';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:geolocator/geolocator.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:permission_handler/permission_handler.dart' hide ServiceStatus;
import 'package:flutter_activity_recognition/flutter_activity_recognition.dart' as ar;
import 'api_service.dart';
import 'local_storage.dart';
import '../models/local_point.dart';
import '../utils/kalman_filter.dart';
import '../utils/motion_detector.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:connectivity_plus/connectivity_plus.dart';
import 'socket_service.dart';
import 'package:dio/dio.dart'; // ✅ FIX: Added for Options class
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:url_launcher/url_launcher.dart';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
ServiceInstance? _globalServiceInstance;

void _log(String tag, String message) {
  final timestamp = DateTime.now().toString().split(' ').last.substring(0, 12);
  final fullMsg = '[$timestamp][$tag] $message';
  // ignore: avoid_print
  print(fullMsg);
  
  // Enviar a la UI si está conectada
  _globalServiceInstance?.invoke('log_event', {
    'msg': fullMsg,
  });
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
  DateTime _lastValidLocationTime = DateTime.parse("2020-01-01 00:00:00");
  LocalPoint? _lastValidPoint;
  double _lastRawLat = 0;
  double _lastRawLng = 0;
  double _totalDistanceKm = 0.0;

  // PRO: Buffering & Caching
  final List<LocalPoint> _pointBuffer = [];
  String? _cachedToken;
  int? _cachedEmployeeId;

   // PRO: Hysteresis & Filtering
  DateTime _lastStateChangeTime = DateTime.now();
  int _highSpeedTicks = 0;
  int _stationaryTicks = 0;

  // Socket status cache
  bool _isSocketConnectedByAdmin = true;
  String? _lastSentGpsState;
  // ── CANAL ÚNICO: HTTP batch (el socket solo recibe comandos) ──────────────
  // _offlineBuffer eliminado — todo va por SQLite → _syncLoop
  static const int _maxBufferSize = 500;
  static const int _gapThresholdMs = 20 * 60 * 1000; // 20 min unificado

  // ── Conectividad: event-driven, sin polling ───────────────────────────────
  bool _isOnline = true; // Asumimos online al inicio, el listener corrige
  DateTime? _wentOfflineAt; // Para saber cuánto tiempo estuvo sin señal

  // FIX C5: guardamos la referencia al ServiceInstance para siempre estar disponible
  ServiceInstance? _serviceInstance;
  io.Socket? _socket;
  bool _isManualSocketJoinPending = false; // ✅ Track manually if join is needed

  // ── Subscripciones ─────────────────────────────────────────────────────────
  StreamSubscription<Position>? _positionStreamSub;
  StreamSubscription<ar.Activity>? _activityStreamSub;

  // PRO: Unified Maintenance Timer
  Timer? _mainMaintenanceTimer;
  Timer? _syncTimer;
  int _maintenanceTicks = 0;

  // SUBS: Connectivity
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  // FIX V3: Guard para evitar subidas paralelas
  bool _isSyncing = false;

  // FIX DEEP-AUDIT: Guard para evitar solapamiento de procesamiento GPS
  bool _isProcessingPosition = false;

  // FIX DEEP-AUDIT: Guard para evitar reinicios de stream concurrentes
  bool _isRestartingStream = false;
  bool _isSleepModeActive = false;
  bool _isPriorityScanActive = false;
  int _priorityScanTicks = 0;

  // NUEVO: Guardar el intervalo actual para el Watchdog
  int _currentIntervalSec = 30;

  // NUEVO: Blindaje Anti-Caos (Reset Storm & Backoff)
  DateTime? _lastResetTime;
  int _resetCount = 0;
  DateTime _nextSyncAttempt = DateTime.now(); // ✅ Time-based backoff instead of ticks
  LocalPoint? _lastProcessedPos; // Para Freeze Detection
  DateTime? _lastStaticTime;     // Para Freeze Detection
  bool _isInRecoveryBoost = false;
  Timer? _recoveryBoostTimer;

  // FIX LIVE: Guardar si el admin pidió ubicación mientras offline
  bool _pendingLocationRequest = false;

  // ZUPT: detector de quietud por acelerómetro
  final MotionDetector _motionDetector = MotionDetector();

  // BUG #1 FIX: guard con timestamp para detectar bloqueo permanente
  DateTime? _lastProcessingStart;

  // BUG #7 FIX: guard atómico para hard reset
  bool _isResetting = false;

  // CRÍTICO 4: Protección contra reset loop — degraded mode
  int _recentResetCount = 0;
  DateTime _resetWindowStart = DateTime.now();
  bool _isDegradedMode = false;
  Timer? _degradedModeTimer;

  // CRÍTICO 3: Heartbeat independiente del GPS (cada 60s)
  Timer? _heartbeatTimer;

  // BUG #13 FIX: contador propio del sync timer (independiente de _maintenanceTicks)
  int _syncTicks = 0;

  // BUG #6 FIX: cache del estado de notificación para evitar IPC en cada punto GPS
  TrackingState? _lastNotificationState;
  bool _isForegroundCached = true;
  ar.ActivityType? _lastLoggedActivity; // Filtro de spam de logs

  // GPS-OFF: detección y fallback por red + listener event-driven
  bool _gpsWasOff = false;
  StreamSubscription<ServiceStatus>? _gpsStatusSub; // Event-driven, cero polling
  StreamSubscription<Position>? _networkLocationSub; // Fallback por WiFi/torres
  static final _localNotif = FlutterLocalNotificationsPlugin();

  // FIX V3: Timestamp del último punto RAW de GPS para el Watchdog
  DateTime _lastRawTime = DateTime.now();

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
      _log('INIT', '>>> [FLOW-START] TrackingEngine.start() called');
      _serviceInstance = service;
      _currentState = TrackingState.STOPPED;
      _lastValidLocationTime = DateTime.now();
      _lastProcessingStart = DateTime.now();

      // Wake lock solo cuando sea necesario (ver _applyWakelock)
      _applyWakelock();

      // 1. Inicializar Sensores (NO BLOQUEANTE para evitar colgar el isolate)
      _motionDetector.start();
      _log('INIT', 'Sensors: [FLOW-PROC] MotionDetector iniciado');
      
      // No esperamos (await) a ActivityRecognition ni otros sensores no críticos para no retrasar el GPS
      _initActivityRecognition().then((_) => _log('INIT', 'Sensors: [FLOW-PROC] Activity Recognition listo')).catchError((e) => _log('INIT', 'Sensors: Error en Activity: $e'));
      _initConnectivityListener();
      _initBatteryStateListener();

      // Notificaciones locales para alerta de GPS apagado
      await _localNotif.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
        onDidReceiveNotificationResponse: (details) async {
          // Tap en notificación → abrir configuración de ubicación del sistema
          final uri = Uri.parse('android.settings.LOCATION_SOURCE_SETTINGS');
          if (await canLaunchUrl(uri)) launchUrl(uri);
        },
      );

      // PRO: Unified Maintenance Loop (60s)
      _mainMaintenanceTimer = Timer.periodic(const Duration(seconds: 60), (_) {
        try {
          _runMaintenanceTasks();
        } catch (e) {
          _log('CRITICAL', 'Fallo en Main Maintenance Timer: $e');
        }
      });

      // ── SYNC TIMER: solo corre cuando hay red Y hay algo que enviar ──────────
      // La frecuencia se adapta al estado de movimiento.
      // Si no hay red (_isOnline=false), el timer existe pero _syncLoop sale inmediatamente.
      // El trigger real al reconectar lo hace _initConnectivityListener.
      _syncTimer = Timer.periodic(const Duration(seconds: 10), (_) async {
        _syncTicks++; // BUG #4 FIX: contador propio, independiente del maintenance loop
        if (!_isOnline) return;
        if (_currentState == TrackingState.PAUSED) return; // Solo bloquear si admin pausó

        final tickInterval = switch (_currentState) {
          TrackingState.DRIVING    => 1,
          TrackingState.WALKING    => 1,
          TrackingState.STOPPED    => 6,    // 60s
          TrackingState.BATT_SAVER => 12,   // 120s
          TrackingState.DEEP_SLEEP => 18,   // 180s — sigue sincronizando, solo más lento
          _                        => 6,
        };
        if (_syncTicks % tickInterval != 0) return;

        final pending = await _storage.getUnsyncedCount();
        if (pending == 0) return;

        _syncLoop(reason: 'Timer [${_currentState.name}] ($pending pts)');
      });

      // CRÍTICO 3: Heartbeat independiente del GPS — prueba que el servicio está vivo
      // Se envía incluso en DEEP_SLEEP, incluso sin movimiento
      _heartbeatTimer = Timer.periodic(const Duration(seconds: 60), (_) async {
        try {
          await _sendServiceHeartbeat();
        } catch (e) {
          _log('HEARTBEAT', 'Error: $e');
        }
      });

      // FIX 1: Reinicio limpio de distancia al iniciar
      _totalDistanceKm = 0;
      _lastValidPoint = null;
      _pointBuffer.clear();

      // Hydratación diferida para no bloquear el inicio
      _deferredInitialization();

      // 2. Iniciar el motor de ubicación (CRÍTICO)
      _log('INIT', 'Arrancando [FLOW-PROC] Location Stream...');
      await _startLocationStream(reason: 'Initial Start');
      _log('INIT', '>>> [FLOW-READY] TrackingEngine listo');
    } catch (e, stack) {
      _log('CRITICAL', 'Error fatal en engine.start(): $e\n$stack');
    }
  }

  // Inicialización diferida para evitar bloquear el arranque del isolate
  Future<void> _deferredInitialization() async {
    _log('INIT', '>>> _deferredInitialization() [ENTER]');
    try {
      // Guard de autoStart: si no hay token (vendedor nunca hizo login), detener el servicio
      _cachedToken = await _api.getToken();
      if (_cachedToken == null) {
        _log('INIT', 'Sin token — servicio iniciado por autoStart sin login previo. Deteniendo.');
        _serviceInstance?.stopSelf();
        return;
      }

      await _loadCachedEmployeeId();
      await _restoreStateFromStorage();

      // Verificar estado de rastreo en el servidor
      // Si el admin lo desactivó mientras el teléfono estaba apagado, respetarlo
      final profile = await _api.fetchMyProfile();
      if (profile != null) {
        final bool isTrackingEnabled = profile['is_tracking_enabled'] ?? true;
        _log('FLOW-DIAG', 'Profile check: is_tracking_enabled=$isTrackingEnabled');
        if (!isTrackingEnabled) {
          _log('FLOW-DIAG', 'ENTER PAUSE: admin desactivó el rastreo');
          pause();
        } else {
          // Rastreo habilitado — forzar sync inmediato por si hay puntos acumulados
          _log('FLOW-DIAG', 'Rastreo activo — forzando sync inicial');
          _syncLoop(reason: 'Deferred Init');
        }
      } else {
        _log('FLOW-DIAG', 'Profile check FAILED (null response) — continuando con estado anterior');
        // Intentar sync de todas formas — puede haber puntos acumulados
        _syncLoop(reason: 'Deferred Init (profile failed)');
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
    _syncTimer?.cancel();
    _heartbeatTimer?.cancel();
    _positionStreamSub?.cancel();
    _activityStreamSub?.cancel();
    _connectivitySub?.cancel();
    _gpsStatusSub?.cancel();
    _networkLocationSub?.cancel();
    _localNotif.cancel(9001);
    _motionDetector.stop();

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
    _syncTimer?.cancel();
    _motionDetector.stop();
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
    _motionDetector.start();
    _startLocationStream(reason: 'Remote Resume');
    
    // Reiniciar loops
    _mainMaintenanceTimer?.cancel();
    _mainMaintenanceTimer = Timer.periodic(const Duration(seconds: 60), (_) => _runMaintenanceTasks());
    _syncTimer?.cancel();
    _syncTimer = Timer.periodic(const Duration(seconds: 10), (_) async {
      if (!_isOnline) return;
      if (_currentState != TrackingState.PAUSED) {
        final pending = await _storage.getUnsyncedCount();
        if (pending > 0) _syncLoop(reason: 'Timer (resumed)');
      }
    });
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 60), (_) async {
      try { await _sendServiceHeartbeat(); } catch (e) { _log('HEARTBEAT', 'Error: $e'); }
    });
  }

  void updateSocketStatus(bool connected) {
    _isSocketConnectedByAdmin = connected;
    _updateNotification();
  }

  void setSocket(io.Socket socket) {
    _socket = socket;
  }

  Future<void> handleRemoteLocationRequest() async {
    _log('RADAR', 'Comando manual recibido — Iniciando secuencia de localización forzada');
    _pendingLocationRequest = true;

    // 🚀 FEEDBACK INSTANTÁNEO: Enviar último punto conocido o forzar IP Location si el GPS está apagado
    final bool isGpsEnabled = await Geolocator.isLocationServiceEnabled();
    if (!isGpsEnabled) {
      _log('RADAR', 'GPS OFF detectado. Forzando GeoIP...');
      await _sendNoFixHeartbeat(reason: 'Manual Location Request', isManual: true);
    } else if (_lastValidPoint != null) {
      // ✅ FIX: Solo enviar si el punto es "fresco" (< 2 min)
      final ageSec = DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(_lastValidPoint!.timestamp)).inSeconds;
      if (ageSec < 120) {
        _log('RADAR', 'Enviando última ubicación fresca (${ageSec}s) interna');
        _emitToSocket(_lastValidPoint!, manual: true);
      } else {
        _log('RADAR', 'Última ubicación obsoleta (${ageSec}s). Esperando nuevo fix...');
      }
    } else {
      // ⚠️ CASO GPS OFF o Sin Datos: forzar heartbeat con GeoIP manual
      await _sendNoFixHeartbeat(reason: 'Manual Location Request', isManual: true);
    }

    if (_serviceInstance is AndroidServiceInstance) {
      (_serviceInstance as AndroidServiceInstance).setForegroundNotificationInfo(
        title: '📍 LOCALIZANDO AHORA...',
        content: 'El administrador ha solicitado tu ubicación exacta.',
      );
    }

    _isPriorityScanActive = true;
    _priorityScanTicks = 0;

    // --- CAPA 2: Last Known Position (Hardware) ---
    try {
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null) {
        _log('RADAR', 'Enviando LastKnownPosition del sistema: ${lastKnown.accuracy}m');
        _emitManualPosition(lastKnown, source: 'hardware_last_known');
      }
    } catch (e) {
      _log('RADAR', 'Error obteniendo LastKnown: $e');
    }

    // --- CAPA 3: Quick Fix (WiFi/Network - 5 seg) ---
    Geolocator.getCurrentPosition(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.low,
        timeLimit: const Duration(seconds: 5),
      ),
    ).then((pos) {
      _log('RADAR', 'Quick Fix obtenido (WiFi/Network): ${pos.accuracy}m');
      _emitManualPosition(pos, source: 'quick_fix_network');
    }).catchError((e) => _log('RADAR', 'Quick Fix falló o timeout: $e'));

    // --- CAPA 4: Fix Exacto (GPS - 25 seg) ---
    Geolocator.getCurrentPosition(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.best,
        forceLocationManager: false,
      ),
      timeLimit: const Duration(seconds: 25),
    ).then((pos) {
      _log('RADAR', '✅ Fix Exacto obtenido: ${pos.accuracy}m');
      _emitManualPosition(pos, source: 'high_accuracy_gps');
      _lastValidPoint = _pointFromPosition(pos, source: 'high_accuracy_gps');
      _pendingLocationRequest = false;
    }).catchError((e) {
      _log('RADAR', 'Fix exacto falló o timeout: $e');
      _pendingLocationRequest = false;
    });

    // Iniciar el stream de alta frecuencia
    _restartLocationStream(reason: 'Priority Scan Triggered by Radar');
  }

  void _emitManualPosition(Position pos, {required String source}) {
    final point = _pointFromPosition(pos, source: source);
    // Encolar en SQLite y forzar sync inmediato (HTTP-only mode)
    _addToBufferAndFlush(point.toJson()).then((_) => _syncLoop(reason: 'Manual Position ($source)'));
  }

  LocalPoint _pointFromPosition(Position pos, {String? source}) {
    // Determinar fuente real
    String src;
    if (source != null) {
      src = source;
    } else if (pos.accuracy <= 25 && pos.provider != null && pos.provider!.toLowerCase().contains('gps')) {
      src = 'gps';
    } else if (pos.provider != null && pos.provider!.toLowerCase().contains('wifi')) {
      src = 'wifi';
    } else if (pos.provider != null && pos.provider!.toLowerCase().contains('cell')) {
      src = 'cell';
    } else if (pos.accuracy > 50) {
      src = 'fallback';
    } else {
      src = 'unknown';
    }
    return LocalPoint(
        lat: pos.latitude,
        lng: pos.longitude,
        speed: pos.speed * 3.6,
        accuracy: pos.accuracy,
        state: _currentState.name,
        timestamp: pos.timestamp.millisecondsSinceEpoch,
        employeeId: _cachedEmployeeId,
        source: src,
    );
  }

  // Llamar cuando el socket reconecta — envía ubicación pendiente al admin
  void onSocketReconnected() {
    _log('SOCKET', 'Socket reconectado');
    _updateNotification();
    
    // ✅ TRIGGER PRO: Resetear backoff y forzar sync al reconectar socket
    _nextSyncAttempt = DateTime.now();
    _syncLoop(reason: 'Socket Reconnected');

    if (_pendingLocationRequest && _lastValidPoint != null) {
      _log('SOCKET', 'Enviando ubicación pendiente al admin (guardada offline)');
      _emitToSocket(_lastValidPoint!);
      _pendingLocationRequest = false;
    }
  }

  Future<void> _emitToSocket(LocalPoint point, {bool manual = false}) async {
    // El socket ya NO envía ubicaciones — solo se usa para recibir comandos del admin.
    // Las ubicaciones van exclusivamente por HTTP batch (_syncLoop).
    // Esto elimina la desincronización y los recorridos erráticos causados por
    // el socket en conexiones 3G inestables.
    _log('SOCKET', 'Socket-send deshabilitado (HTTP-only mode). Punto encolado para batch.');
  }

  void _updateNotification() async {
    // BUG #6 FIX: evitar IPC a Android en cada punto GPS
    // Solo actualizar si el estado cambió realmente
    if (_lastNotificationState == _currentState) return;
    _lastNotificationState = _currentState;

    final svc = _serviceInstance;
    if (svc == null || svc is! AndroidServiceInstance) return;

    final String title;
    final String content;

    if (_currentState == TrackingState.PAUSED) {
      title = 'Rastreo Pausado ⏸️';
      content = 'El administrador ha desactivado el rastreo.';
    } else {
      final icons = {
        TrackingState.DRIVING:    '🚗',
        TrackingState.WALKING:    '🚶',
        TrackingState.STOPPED:    '⏸️',
        TrackingState.DEEP_SLEEP: '😴',
        TrackingState.BATT_SAVER: '🔋',
        TrackingState.NO_SIGNAL:  '📵',
        TrackingState.PAUSED:     '⏸️',
      };
      final icon = icons[_currentState] ?? '📍';
      title = '$icon Rastreo activo · ${_currentState.name}';
      content = 'Cola: ${_pointBuffer.length} pts pendientes';
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
      if (lastPoint != null && lastPoint.lat != 0.0 && lastPoint.lng != 0.0) {
        _lastValidPoint = lastPoint;
        _lastValidLocationTime = DateTime.fromMillisecondsSinceEpoch(lastPoint.timestamp);
        _log('RESTORE', 'Último punto restaurado: ${lastPoint.lat}, ${lastPoint.lng} '
            '@ ${_lastValidLocationTime.toIso8601String()}');
      } else if (lastPoint != null && lastPoint.lat == 0.0) {
        _log('RESTORE', 'Omitiendo punto 0.0,0.0 detectado en Storage (Limpieza de estado)');
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
          // FILTRO DE SPAM: Solo loguear si cambia el tipo o han pasado > 5 min
          if (activity.type != _lastLoggedActivity) {
            _log('ACTIVITY', 'Detectado: ${activity.type.name} (Confianza: ${activity.confidence})');
            _lastLoggedActivity = activity.type;
          }
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

  void _initConnectivityListener() {
    _log('INIT', 'Iniciando Connectivity Listener (event-driven)...');

    // Verificar estado inicial de red
    Connectivity().checkConnectivity().then((results) {
      _isOnline = results.any((r) => r != ConnectivityResult.none);
      _log('CONN', 'Estado inicial de red: ${_isOnline ? "ONLINE" : "OFFLINE"}');
      if (_isOnline) _syncLoop(reason: 'Initial Online Check');
    });

    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final wasOnline = _isOnline;
      _isOnline = results.any((r) => r != ConnectivityResult.none);

      if (!wasOnline && _isOnline) {
        // ── RECONEXIÓN: el OS nos avisa que hay red ──────────────────────────
        final offlineDuration = _wentOfflineAt != null
            ? DateTime.now().difference(_wentOfflineAt!).inMinutes
            : 0;
        _log('CONN', '🟢 Red restaurada (estuvo offline ~${offlineDuration}m) → Sync inmediato');

        // Reset backoff — la red volvió, no tiene sentido esperar
        _backoffIndex = 0;
        _consecutiveFailures = 0;
        _nextSyncAttempt = DateTime.now();
        _wentOfflineAt = null;

        // Sync inmediato sin esperar el timer
        _syncLoop(reason: 'Network Restored (${offlineDuration}m offline)');

      } else if (wasOnline && !_isOnline) {
        // ── DESCONEXIÓN: guardar cuándo se fue la señal ──────────────────────
        _wentOfflineAt = DateTime.now();
        _log('CONN', '🔴 Red perdida — modo offline. Guardando en SQLite hasta reconexión.');
        // No hacer nada más. El GPS sigue capturando → SQLite.
        // El sync se reactiva solo cuando el OS diga que hay red de nuevo.
      }
    });
  }

  // ✅ NUEVO: Manejar cambios en el estado de carga
  void _initBatteryStateListener() {
    _battery.onBatteryStateChanged.listen(_handleBatteryStateChange);
  }

  void _handleBatteryStateChange(BatteryState state) {
    _log('BATT-EVENT', 'Nuevo estado detectado: ${state.name}');
    if (state == BatteryState.charging || state == BatteryState.full) {
      if (_currentState == TrackingState.BATT_SAVER || _currentState == TrackingState.DEEP_SLEEP || _currentState == TrackingState.NO_SIGNAL) {
        _log('BATT-EVENT', 'Cargador detectado -> Activando RECOVERY BOOST (3s interval)');
        _activateRecoveryBoost();
        _setState(TrackingState.STOPPED, reason: 'Charging Started');
      }
    }
  }

  void _activateRecoveryBoost() {
    _isInRecoveryBoost = true;
    _recoveryBoostTimer?.cancel();
    _recoveryBoostTimer = Timer(const Duration(seconds: 60), () {
      _log('RECOVERY', 'Fin de Recovery Boost. Volviendo a parámetros normales.');
      _isInRecoveryBoost = false;
      _restartLocationStream(reason: 'Recovery Boost Timeout');
    });
    // Forzamos reinicio con frecuencia alta inmediatamente
    _restartLocationStream(reason: 'Recovery Boost Start');
  }

  // ---------------------------------------------------------------------------
  // Loop de Mantenimiento Unificado (60s)
  // ---------------------------------------------------------------------------
  Future<void> _runMaintenanceTasks() async {
    _maintenanceTicks++;
    _log('MAIN', 'Loop #$_maintenanceTicks [ENTER]');

    // ✅ SOCKET WATCHDOG: Asegurar que el socket intente reconectar si murió
    if (_socket != null && !_socket!.connected) {
      _log('SOCKET', 'Watchdog: Socket detectado offline, intentando reconexión forzada...');
      _socket!.connect();
    } else if (_socket != null && _socket!.connected && _isManualSocketJoinPending) {
       // Si está conectado pero falló el join inicial o se reinició el isolate
       if (_cachedEmployeeId != null) {
          _socket!.emit('join_employee', _cachedEmployeeId);
          _isManualSocketJoinPending = false;
          onSocketReconnected();
       }
    }

    try {
      // 1. Throttling por Batería
      await _updateBatteryAndThrottling();

      // 2. Flush de Buffer a SQLite
      await _flushBufferToStorage();

      // 3. Flush de SQLite a API (Solo si bat > 10%)
      final level = await _battery.batteryLevel;
      if (level > 10) {
        _syncLoop(reason: 'Maintenance Loop');
      }

      // 4. Check for remote commands (Modo Despertar)
      await _checkRemoteCommands();

      // 5. Priority Scan Watchdog
      if (_isPriorityScanActive) {
        _priorityScanTicks++;
        if (_priorityScanTicks >= 3) { // Reducido a 3m para ahorrar batería
          _log('GPS', 'Finalizando prioridad de escaneo (Timeout 3m)');
          _isPriorityScanActive = false;
          _restartLocationStream(reason: 'End Priority Scan');
        }
      }

      // 6. Emitter al UI (Menos frecuente para ahorrar CPU)
      _serviceInstance?.invoke('trackingState', {
        'is_active': true,
        'state': _currentState.name,
      });

      // 7. Watchdog de Salud (GPS/Túneles)
      await _checkWatchdogHealth();
      
      // 8. Limpieza periódica (24h) — BUG #15 FIX: contador propio para no resetear _maintenanceTicks
      if (_maintenanceTicks % 1440 == 0 && _maintenanceTicks > 0) {
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
      if (level < 25 && _currentState != TrackingState.BATT_SAVER && _currentState != TrackingState.PAUSED) {
        _setState(TrackingState.BATT_SAVER, reason: 'Power Savings (<25%)');
      } else if (level >= 35 && _currentState == TrackingState.BATT_SAVER) {
        _setState(TrackingState.STOPPED, reason: 'Battery recovered');
      }
    } catch (e) {
      _log('BATT', 'Sensor falló: $e');
    }
  }

  // Los comandos remotos llegan por socket (join_employee room).
  // Este método se mantiene como fallback solo si el socket está desconectado.
  Future<void> _checkRemoteCommands() async {
    if (_currentState == TrackingState.PAUSED) return;
    // Solo consultar si el socket está caído (evita petición redundante)
    if (_socket != null && _socket!.connected) return;
    try {
      final dio = await _api.getDio();
      final token = await _api.getToken();
      final res = await dio.get(
        '/api/employees/commands',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200 && res.data['command'] == 'locate') {
        _log('POLLING', 'Comando manual detectado vía HTTP fallback');
        handleRemoteLocationRequest();
      }
    } catch (_) {
      // Silencioso — el endpoint puede no existir en todas las versiones del servidor
    }
  }

  Future<void> _checkWatchdogHealth() async {
    final now = DateTime.now();
    final diff = now.difference(_lastValidLocationTime).inSeconds;
    
    // ✅ WATCHDOG PRO: Umbral dinámico para evitar bucles en bajo consumo
    // Usamos interval * 2 + 10s para dar margen a Android/Hardware.
    final watchdogThreshold = (_currentIntervalSec * 2) + 10;
    
    // ✅ NUEVO: Detectar si el usuario apagó el GPS (Global Switch)
    final isGpsEnabled = await Geolocator.isLocationServiceEnabled();
    if (!isGpsEnabled) {
      _log('ANTI-FRAUDE', '⚠️ GPS APAGADO POR EL USUARIO');
      _sendNoFixHeartbeat(reason: 'gps_disabled_by_user');
      _setState(TrackingState.NO_SIGNAL, reason: 'GPS Disabled');
      if (!_gpsWasOff) {
        _gpsWasOff = true;
        _onGpsDisabled();
      }
      return;
    } else if (_gpsWasOff) {
      // GPS volvió a encenderse
      _gpsWasOff = false;
      _onGpsRestored();
    }

    // GPS Watchdog: si estamos en movimiento pero no recibimos nada
    final rawDiff = now.difference(_lastRawTime).inSeconds;
    if (rawDiff > watchdogThreshold && _currentState != TrackingState.DEEP_SLEEP && _currentState != TrackingState.STOPPED && _currentState != TrackingState.PAUSED) {
      _log('WATCHDOG', 'Timeout detectado: ${rawDiff}s sin datos GPS (umbral: ${watchdogThreshold}s)');
      _hardResetGPS(reason: 'watchdog_timeout');
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

  // CRÍTICO 3: Heartbeat independiente del GPS
  // Envía estado del servicio cada 60s — prueba que el proceso está vivo aunque no haya GPS
  Future<void> _sendServiceHeartbeat() async {
    if (!_isOnline || _cachedToken == null) return;
    try {
      final now = DateTime.now().millisecondsSinceEpoch;
      final lastGpsAge = now - (_lastValidPoint?.timestamp ?? 0);

      // ✅ FIX: No enviar heartbeats si aún no tenemos una ubicación válida inicial (evita 0,0)
      if ((_lastValidPoint == null || _lastValidPoint!.lat == 0.0) && _lastRawLat == 0.0) {
        _log('HEARTBEAT', 'Omitiendo heartbeat: Sin ubicación válida para reportar aún.');
        return;
      }

      _log('HEARTBEAT', 'Enviando heartbeat (GPS age: ${lastGpsAge ~/ 1000}s, state: ${_currentState.name})');

      final batteryLevel = await _battery.batteryLevel;
      final batteryState = await _battery.batteryState;
      final isCharging = batteryState == BatteryState.charging || batteryState == BatteryState.full;
      final isGpsEnabled = await Geolocator.isLocationServiceEnabled();

      // 🟡 2: Razón del estado + último evento significativo
      String heartbeatReason;
      if (!isGpsEnabled) {
        heartbeatReason = 'no_gps';
      } else if (!_isOnline) {
        heartbeatReason = 'no_network';
      } else if (_isDegradedMode) {
        heartbeatReason = 'degraded_mode';
      } else if (_currentState == TrackingState.DEEP_SLEEP) {
        heartbeatReason = 'deep_sleep';
      } else if (_currentState == TrackingState.BATT_SAVER) {
        heartbeatReason = 'battery_saver';
      } else {
        heartbeatReason = 'gps_timeout';
      }

      final point = {
        'lat': _lastValidPoint?.lat ?? _lastRawLat,
        'lng': _lastValidPoint?.lng ?? _lastRawLng,
        'speed': 0,
        'accuracy': _lastValidPoint != null ? _lastValidPoint!.accuracy : 9999,
        'state': _currentState.name,
        'timestamp': now,
        'point_type': 'heartbeat',
        'source': 'heartbeat',
        'battery': batteryLevel,
        'is_charging': isCharging,
        'heartbeat_meta': {
          // 🟡 2: Último evento significativo — permite detectar "vivo pero congelado"
          'last_gps_ts':       _lastValidPoint?.timestamp ?? 0,
          'last_gps_age_s':    lastGpsAge ~/ 1000,
          'last_sync_ts':      _nextSyncAttempt.millisecondsSinceEpoch,
          'socket_connected':  _socket?.connected ?? false,
          // 🟡 1: Razón del estado para debug humano
          'reason':            heartbeatReason,
          'is_gps_enabled':    isGpsEnabled,
          'is_degraded':       _isDegradedMode,
          'reset_count':       _resetCount,
          'battery_level':     batteryLevel,
          'tracking_state':    _currentState.name,
        },
      };

      await _addToBufferAndFlush(point);
      _syncLoop(reason: 'Heartbeat');
    } catch (e) {
      _log('HEARTBEAT', 'Error enviando heartbeat: $e');
    }
  }

  // ✅ NUEVO: HARD RESET CON BACKOFF (Blindaje Anti-Caos)
  bool _canPerformReset() {
    // CRÍTICO 4: Si estamos en modo degradado, bloquear resets por completo
    if (_isDegradedMode) {
      _log('RESET', 'Degraded Mode activo — reset bloqueado hasta que expire el timer.');
      return false;
    }

    // Ventana deslizante de 5 minutos para contar resets
    final now = DateTime.now();
    if (now.difference(_resetWindowStart).inMinutes >= 5) {
      _recentResetCount = 0;
      _resetWindowStart = now;
    }

    // CRÍTICO 4: >3 resets en 5 min → entrar en degraded mode
    if (_recentResetCount >= 3) {
      _log('RESET', '⚠️ Reset Storm detectado ($_recentResetCount resets en 5min) → DEGRADED MODE por 5min');
      _isDegradedMode = true;
      _degradedModeTimer?.cancel();
      _degradedModeTimer = Timer(const Duration(minutes: 5), () {
        _isDegradedMode = false;
        _recentResetCount = 0;
        _log('RESET', 'Degraded Mode expirado — volviendo a operación normal');
        _restartLocationStream(reason: 'Degraded Mode Expired');
      });
      // En degraded mode: bajar precisión y aumentar intervalo
      _restartLocationStream(reason: 'Enter Degraded Mode');
      return false;
    }

    if (_lastResetTime == null) return true;
    
    final diff = now.difference(_lastResetTime!).inSeconds;
    // Backoff exponencial: 60, 120, 240, 480...
    final backoffSeconds = 60 * (1 << (_resetCount % 5));
    
    if (diff < backoffSeconds) {
      _log('RESET', 'Reset Storm Protection: Mínimo ${backoffSeconds}s entre resets. (Diff: ${diff}s). Abortando reset.');
      return false;
    }
    return true;
  }

  Future<void> _hardResetGPS({required String reason}) async {
    if (_isResetting) return; // BUG #7 FIX: guard atómico contra llamadas concurrentes
    if (!_canPerformReset()) return;
    _isResetting = true;

    _recentResetCount++; // CRÍTICO 4: contar para detectar reset storm
    _log('RESET', '🔥 HARD RESET GPS iniciado. Razón: $reason. Intento #${_resetCount + 1} (recientes: $_recentResetCount/3)');
    _lastResetTime = DateTime.now();
    _resetCount++;

    try {
      await _sendNoFixHeartbeat(reason: reason);
      await _positionStreamSub?.cancel();
      _positionStreamSub = null;
      await Future.delayed(const Duration(milliseconds: 1500));
      _restartLocationStream(reason: 'Hard Reset ($reason)');
    } finally {
      _isResetting = false;
    }
  }

  // ✅ NUEVO: Enviar heartbeat al servidor cuando el GPS falla pero el app está viva
  // OPTIMIZACIÓN "PLAN SILENCIOSO": Solo envía si el estado cambió o si es manual
  Future<void> _sendNoFixHeartbeat({String reason = 'unknown', bool isManual = false}) async {
    try {
      final isGpsEnabled = await Geolocator.isLocationServiceEnabled();
      final currentState = isGpsEnabled ? 'NO_FIX' : 'GPS_OFF';
      
      // ✅ FILTRO DE BATERÍA & ANTI-SPAM: Si el estado no ha cambiado y NO es manual, enmudecer.
      if (!isManual && (_lastSentGpsState == currentState || (_lastSentGpsState == 'PAUSED' && currentState == 'GPS_OFF'))) {
        return; 
      }

      _log('WATCHDOG-SILENT', 'Enviando Aviso de Cambio de Estado: $currentState ($reason)...');
      
      final now = DateTime.now().millisecondsSinceEpoch;
      
      // ✅ FIX LIVE: Enviar última coordenada conocida para evitar que el mapa salte a la costa de áfrica (0,0)
      final useLat = _lastValidPoint?.lat ?? _lastRawLat;
      final useLng = _lastValidPoint?.lng ?? _lastRawLng;

      final batteryLevel = await _battery.batteryLevel;
      final batteryState = await _battery.batteryState;
      final isCharging = batteryState == BatteryState.charging || batteryState == BatteryState.full;

      final point = {
        'lat': useLat,
        'lng': useLng,
        'speed': 0,
        'accuracy': 999,
        'state': currentState,
        'timestamp': now,
        'gps_timestamp': _lastValidPoint?.timestamp ?? now,
        'reset_reason': reason,
        'point_type': isManual ? 'manual' : 'gps_off', // ✅ Estandarizado
        'is_manual_request': isManual, // ✅ Necesario para activar GeoIP en backend
        'source': isGpsEnabled ? 'heartbeat' : 'system_alert',
        'battery': batteryLevel,
        'is_charging': isCharging,
      };
      
      await _addToBufferAndFlush(point);
      
      // Si es manual, forzar sync inmediato para que el backend calcule GeoIP
      if (isManual) {
        _log('RADAR', 'Forzando SyncLoop Inmediato para procesar GeoIP...');
        _syncLoop(reason: 'Manual IP Location Request');
        return;
      }
      
      // Heartbeat de estado va por HTTP batch (no socket)
      _syncLoop(reason: 'Heartbeat State Change');

      // Recordar último estado enviado para no repetir
      _lastSentGpsState = currentState;
      
    } catch (e) {
      _log('WATCHDOG', 'Error enviando heartbeat: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // GPS OFF: Notificación persistente + fallback por red + polling de recuperación
  // ---------------------------------------------------------------------------

  /// Llamado UNA VEZ cuando el GPS pasa de ON → OFF
  void _onGpsDisabled() {
    _log('GPS-OFF', '🔴 GPS desactivado por el usuario — activando contramedidas');

    // 1. Notificación persistente que no se puede descartar, con tap → GPS settings
    _showGpsOffNotification();

    // 2. Fallback: ubicación por WiFi/torres celulares (sin GPS)
    _startNetworkLocationFallback();

    // 3. Event-driven: escuchar cuando el OS activa el GPS (cero polling, cero batería)
    _gpsStatusSub?.cancel();
    _gpsStatusSub = Geolocator.getServiceStatusStream().listen((ServiceStatus status) {
      if (status == ServiceStatus.enabled) {
        _log('GPS-OFF', '✅ GPS restaurado (evento del sistema)');
        _gpsStatusSub?.cancel();
        _gpsStatusSub = null;
        _onGpsRestored();
      }
    });

    // 4. Actualizar notificación del foreground service
    if (_serviceInstance is AndroidServiceInstance) {
      (_serviceInstance as AndroidServiceInstance).setForegroundNotificationInfo(
        title: '⚠️ GPS DESACTIVADO',
        content: 'Toca para reactivar el GPS y continuar el rastreo.',
      );
    }
  }

  /// Llamado cuando el GPS vuelve a encenderse
  void _onGpsRestored() {
    _log('GPS-OFF', '✅ GPS restaurado — cancelando fallback y listener');

    // Cancelar fallback de red
    _networkLocationSub?.cancel();
    _networkLocationSub = null;

    // Cancelar listener de estado (ya no necesario)
    _gpsStatusSub?.cancel();
    _gpsStatusSub = null;

    // Cancelar notificación de GPS off
    _localNotif.cancel(9001);

    // Restaurar notificación normal del foreground
    _lastNotificationState = null; // Forzar refresh
    _updateNotification();

    // Reiniciar stream GPS normal
    _setState(TrackingState.STOPPED, reason: 'GPS Restored');

    // Notificar al backend que el GPS volvió
    _sendNoFixHeartbeat(reason: 'gps_restored');
  }

  /// Notificación local persistente con acción directa a configuración de GPS
  Future<void> _showGpsOffNotification() async {
    const androidDetails = AndroidNotificationDetails(
      'gps_off_channel',
      'GPS Desactivado',
      channelDescription: 'Alerta cuando el GPS está apagado',
      importance: Importance.max,
      priority: Priority.high,
      ongoing: true,           // No se puede descartar con swipe
      autoCancel: false,
      icon: '@mipmap/ic_launcher',
      color: Color(0xFFEF4444),
      actions: [
        AndroidNotificationAction(
          'open_gps',
          'ACTIVAR GPS',
          showsUserInterface: true,
          cancelNotification: false,
        ),
      ],
    );

    await _localNotif.show(
      9001,
      '⚠️ GPS Desactivado',
      'El rastreo está interrumpido. Toca para reactivar el GPS.',
      const NotificationDetails(android: androidDetails),
    );
  }

  /// Fallback: usar WiFi/torres celulares cuando GPS está off
  /// Precisión ~50-200m pero mejor que nada
  void _startNetworkLocationFallback() {
    _networkLocationSub?.cancel();
    _log('GPS-OFF', 'Iniciando fallback por red (WiFi/torres)...');

    _networkLocationSub = Geolocator.getPositionStream(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.low,   // Usa solo WiFi/torres, no GPS
        distanceFilter: 100,              // Solo si se mueve >100m (ahorra batería)
        intervalDuration: Duration(seconds: 60),
        forceLocationManager: true,       // Fuerza LocationManager (no FusedProvider) para evitar GPS
      ),
    ).listen(
      (Position pos) {
        if (pos.accuracy > 500) return; // Descartar si la precisión es muy mala
        _log('GPS-OFF', 'Posición por red: ${pos.latitude},${pos.longitude} acc=${pos.accuracy}m');

        final point = LocalPoint(
          lat: pos.latitude,
          lng: pos.longitude,
          speed: 0,
          accuracy: pos.accuracy,
          state: 'NO_SIGNAL',
          timestamp: pos.timestamp.millisecondsSinceEpoch,
          employeeId: _cachedEmployeeId,
          source: 'network_fallback',
        );
        _addToBufferAndFlush(point.toJson()).then((_) =>
          _syncLoop(reason: 'Network Fallback Position'));
      },
      onError: (e) => _log('GPS-OFF', 'Error en fallback de red: $e'),
    );
  }
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
      } else if (_isDegradedMode) {
        // CRÍTICO 4: Degraded mode — precisión baja, intervalo largo, sin resets
        intervalSec = 60;
        distanceFilter = 30;
        accuracy = LocationAccuracy.low;
        _log('GPS', 'DEGRADED MODE: Reduced accuracy to protect battery (reset storm)');
      } else {
        // 1. Valores por defecto según estado
        switch (_currentState) {
          case TrackingState.STOPPED:
            final secondsStationary = DateTime.now().difference(_lastStateChangeTime).inSeconds;
            if (secondsStationary > 120) { // Sleep mode
              _isSleepModeActive = true;
              intervalSec = 60; 
              distanceFilter = 15; 
              accuracy = LocationAccuracy.low; // Ahorro máximo
              _log('GPS', 'SLEEP MODE: Lowering Accuracy');
            } else {
              _isSleepModeActive = false;
              accuracy = LocationAccuracy.high; // ← Cambiado de medium a high para asegurar fix rápido
              distanceFilter = 5;               // ← Reducido de 15 a 5 para detectar el primer paso inmediatamente
              intervalSec = 25;               // ← Reducido de 30 a 25
            }
            break;
          case TrackingState.DEEP_SLEEP:
            intervalSec = 300; 
            distanceFilter = 30;
            accuracy = LocationAccuracy.low;
            break;
          case TrackingState.BATT_SAVER:
            // Granularidad de thresholds de batería
            final level = await _battery.batteryLevel;
            if (level < 10) {
              intervalSec = 240;
              distanceFilter = 100;
              accuracy = LocationAccuracy.low;
            } else if (level < 20) {
              intervalSec = 180;
              distanceFilter = 70;
              accuracy = LocationAccuracy.low;
            } else if (level < 30) {
              intervalSec = 120;
              distanceFilter = 50;
              accuracy = LocationAccuracy.medium;
            } else {
              intervalSec = 90;
              distanceFilter = 30;
              accuracy = LocationAccuracy.medium;
            }
            _log('GPS', 'BATT_SAVER: Battery $level% | Interval=$intervalSec | Dist=$distanceFilter | Acc=${accuracy.name}');
            break;
          case TrackingState.WALKING:
            intervalSec = 5; 
            distanceFilter = 5; 
            accuracy = LocationAccuracy.medium; // "Balanced" mode para evitar rebotes en ciudad
            break;
          case TrackingState.DRIVING:
          default:
            intervalSec = 5;
            distanceFilter = 10; 
            accuracy = LocationAccuracy.high; // "Outdoor" mode
            break;
        }

        // 2. Overrides por Batería (Granular, fuera de BATT_SAVER)
        final level = await _battery.batteryLevel;
        if (_isInRecoveryBoost) {
          intervalSec = 3;
          accuracy = LocationAccuracy.high;
          distanceFilter = 0;
          _log('GPS', '🚀 RECOVERY BOOST ACTIVE: 3s interval forced');
        } else if (level < 10) {
          intervalSec = 120;
          accuracy = LocationAccuracy.low;
          distanceFilter = 50;
          _log('GPS', 'BATTERY OVERRIDE (<10%): Interval=${intervalSec}s Accuracy=${accuracy.name}');
        } else if (level < 20) {
          intervalSec = 60;
          accuracy = LocationAccuracy.low;
          distanceFilter = 30;
          _log('GPS', 'BATTERY OVERRIDE (<20%): Interval=${intervalSec}s Accuracy=${accuracy.name}');
        } else if (level < 30) {
          intervalSec = 30;
          accuracy = LocationAccuracy.medium;
          distanceFilter = 20;
          _log('GPS', 'BATTERY OVERRIDE (<30%): Interval=${intervalSec}s Accuracy=${accuracy.name}');
        }
      }

      _currentIntervalSec = intervalSec;
      _log('GPS', 'Stream START ($reason) → ${_currentState.name} | ${intervalSec}s | ${distanceFilter}m');

      _positionStreamSub = Geolocator.getPositionStream(
        locationSettings: AndroidSettings(
          accuracy: accuracy,
          distanceFilter: distanceFilter,
          intervalDuration: Duration(seconds: intervalSec),
          forceLocationManager: false, // Usa FusedLocationProvider de Google (Uber/Google Maps mode)
        ),
      ).listen(
        (Position pos) async {
          _log('GPS-RAW', 'Recibido: lat=${pos.latitude}, lng=${pos.longitude}, acc=${pos.accuracy.toStringAsFixed(1)}m, speed=${pos.speed.toStringAsFixed(1)}m/s, provider=${pos.provider}');
          _lastRawTime = DateTime.now();
          // Fallback: Si accuracy es mala (>80m) y GPS está encendido, intentar obtener posición por red
          if (pos.accuracy > 80) {
            try {
              final netPos = await Geolocator.getCurrentPosition(
                locationSettings: AndroidSettings(
                  accuracy: LocationAccuracy.low,
                  timeLimit: const Duration(seconds: 5),
                  forceLocationManager: true, // Forzar WiFi/cell
                ),
              );
              if (netPos.accuracy < pos.accuracy) {
                _log('GPS-FALLBACK', 'Usando posición de red: acc=${netPos.accuracy}m');
                _processNewPosition(netPos);
                return;
              }
            } catch (e) {
              _log('GPS-FALLBACK', 'Error obteniendo posición de red: $e');
            }
          }
          _processNewPosition(pos);
        },
        onError: (e) {
          _log('GPS-RAW', 'Error en stream: $e');
          _hardResetGPS(reason: 'stream_error');
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
    _log('FLOW-ENTRY', 'Iniciando procesamiento de punto (acc: ${pos.accuracy.toStringAsFixed(1)}m)');
    
    // BUG #1 FIX: guard con timeout — si lleva >10s bloqueado es un bug, forzar reset
    if (_isProcessingPosition) {
      final lockTime = DateTime.now().difference(_lastProcessingStart!).inSeconds;
      _log('FLOW-GUARD', 'Procesador ocupado (Lock age: ${lockTime}s)');
      if (lockTime > 15) {
        _log('CRITICAL', '_isProcessingPosition bloqueado >15s — forzando reset del guard');
        _isProcessingPosition = false;
      } else {
        return;
      }
    }
    _lastProcessingStart = DateTime.now();
    _isProcessingPosition = true;

    try {
      final double speed = pos.speed; // m/s
      final double speedKmh = speed * 3.6;
      final pointTime = pos.timestamp; // ✅ FIX: Usar tiempo real del sensor
      final now = DateTime.now();

      // ✅ NIVELES DE CONFIANZA PRO: Capturar Source
      String source = 'gps';
      if (pos.accuracy > 100) source = 'network';
      if (pos.isMocked) source = 'mock';

      // ── 1. FREEZE DETECTION (Nivel Uber) ───────────────────────────────────
      if (_lastProcessedPos != null && _currentState != TrackingState.STOPPED && _currentState != TrackingState.DEEP_SLEEP && _currentState != TrackingState.PAUSED) {
        final dist = Geolocator.distanceBetween(_lastProcessedPos!.lat, _lastProcessedPos!.lng, pos.latitude, pos.longitude);
        final timeDiff = now.difference(_lastStaticTime ?? now).inSeconds;

        if (dist < 10 && speed < 1.0) {
          // El GPS parece no moverse significativamente
          if (timeDiff > 180) {
            _log('FLOW-PROC', '⚠️ [FREEZE] GPS Congelado (${dist.toStringAsFixed(1)}m en ${timeDiff}s)');
            _lastStaticTime = now; 
            _hardResetGPS(reason: 'gps_freeze_detected');
            _isProcessingPosition = false;
            return; 
          }
        } else {
          // Hay movimiento real o cambio de posición, reseteamos el timer de freeze
          _lastStaticTime = now;
        }
      } else {
        _lastStaticTime = now;
      }

      // Actualizamos última posición procesada para la siguiente comparación
      _lastProcessedPos = LocalPoint(
        lat: pos.latitude,
        lng: pos.longitude,
        speed: speed,
        accuracy: pos.accuracy,
        timestamp: pos.timestamp.millisecondsSinceEpoch,
        source: source,
      );

      // --- FILTRO DE CALIDAD DINÁMICO (Por Velocidad) — FIX S2 ---
      // ANTERIOR: umbrales de 12/15/20m — demasiado agresivos para ciudad (GPS urbano ~15–40m típico)
      // NUEVO: umbrales realistas que dejan pasar la ciudad. El EKF del backend limpia el ruido fino.
      bool isGoodForHistory = true;
      double historyAccLimit;
      if (speed < 1.5) historyAccLimit = 35.0;       // Quieto / caminando (ciudad exige más paciencia)
      else if (speed < 10.0) historyAccLimit = 50.0; // Bici / lento
      else historyAccLimit = 65.0;                   // Auto / moto (velocidad alta → aceptamos más error)

      if (pos.accuracy > historyAccLimit) {
        isGoodForHistory = false;
        // 🔍 LOG TEMPORAL S2 — validar descarte en campo (eliminar tras verificación)
        _log('HIST-FILTER', 'Punto EXCLUIDO: acc=${pos.accuracy.toStringAsFixed(1)}m '
            '> límite=${historyAccLimit.toStringAsFixed(0)}m '
            '| speed=${speedKmh.toStringAsFixed(1)}km/h '
            '| state=${_currentState.name}');
      }

      // --- SUAVIZADO MATEMÁTICO — FIX S1: Single-step accuracy-weighted average ---
      // ANTERIOR (roto): doble paso → punto nuevo tenía solo ~23% de influencia real.
      // NUEVO: un solo paso ponderado por (1/accuracy). Alta precisión (5m) → más peso.
      double smoothedLat = pos.latitude;
      double smoothedLng = pos.longitude;

      if (_lastValidPoint != null && isGoodForHistory) {
        // Peso del nuevo punto: inversamente proporcional al error de precisión
        // acc=5m → weight=0.20 | acc=15m → weight=0.067 | acc=30m → weight=0.033
        final double newWeight = 1.0 / pos.accuracy.clamp(1.0, 100.0);
        const double oldWeight = 1.0; // peso fijo del punto anterior como ancla

        smoothedLat = (pos.latitude * newWeight + _lastValidPoint!.lat * oldWeight) / (newWeight + oldWeight);
        smoothedLng = (pos.longitude * newWeight + _lastValidPoint!.lng * oldWeight) / (newWeight + oldWeight);

        // 🔍 LOG TEMPORAL S1 — validar EWMA en campo (eliminar tras verificación)
        final double rawDistM = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng, pos.latitude, pos.longitude);
        final double smoothDistM = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng, smoothedLat, smoothedLng);
        _log('EWMA', 'acc=${pos.accuracy.toStringAsFixed(1)}m '
            'newW=${newWeight.toStringAsFixed(3)} '
            'raw_dist=${rawDistM.toStringAsFixed(1)}m '
            'smooth_dist=${smoothDistM.toStringAsFixed(1)}m '
            '(reduction=${((1-smoothDistM/rawDistM.clamp(0.01,9999))*100).toStringAsFixed(0)}%)');
      }

      // FILTRO 2: Descartar saltos imposibles y picos de ruido
      if (_lastValidPoint != null) {
        final dist = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng,
          pos.latitude, pos.longitude,
        );
        final seconds = pointTime.difference(DateTime.fromMillisecondsSinceEpoch(_lastValidPoint!.timestamp)).inSeconds;
        
        if (seconds > 0) {
          final transitSpeedKmh = (dist / seconds) * 3.6;
          
          // 1. Salto brutal general (> 160 km/h) — pero con RECOVERY si es extremo (> 1000 km/h)
          if (transitSpeedKmh > 160) {
            // ✅ HARD RESET para autocuración: Si el salto es absurdo (> 1000 km/h) 
            // probablemente el _lastValidPoint es basura o de otra sesión lejana.
            // Aceptamos este punto como el nuevo "Origen" (Snap).
            if (transitSpeedKmh > 1000) {
              _log('GPS', 'RECOVERY: Salto extremo (${transitSpeedKmh.toStringAsFixed(0)} km/h). Reseteando origen a este punto.');
              // Al no hacer return, el flujo continuará y este punto se convertirá en _lastValidPoint abajo.
            } else {
              _log('GPS', 'Salto bloqueado: $dist m en $seconds s (${transitSpeedKmh.toStringAsFixed(1)} km/h)');
              _isProcessingPosition = false;
              return;
            }
          }
          
          // 2. Filtro de Picos de Ruido de Precisión (Consistency Filter)
          // Si el salto computado es mucho mayor a la velocidad que reporta el GPS, es un pico malo.
          if (dist > 25.0 && transitSpeedKmh > (speedKmh + 30.0) && pos.accuracy > 12.0) {
            _log('GPS', 'Pico (Spike) filtrado: Salto de ${dist.toStringAsFixed(1)}m imposible a velocidad actual ${speedKmh.toStringAsFixed(1)}km/h');
            _isProcessingPosition = false;
            return;
          }
        }

        // Drift detectado: < 3m y < 0.5 m/s (Evitar que el punto baile estando quieto)
        if (dist < 3 && speed < 0.5 && _currentState == TrackingState.STOPPED) {
          _isProcessingPosition = false;
          return;
        }
      }

      // 2. Hysteresis de Estado (Debouncing de transiciones)
      final secondsInCurrentState = DateTime.now().difference(_lastStateChangeTime).inSeconds;
      TrackingState targetState = _currentState;

      // --- DETECCIÓN DE REPOSO (Lógica de Ticks Estacionarios) ---
      final distFromLast = _lastValidPoint != null 
          ? Geolocator.distanceBetween(_lastValidPoint!.lat, _lastValidPoint!.lng, pos.latitude, pos.longitude)
          : 0.0;

      if (speed < 0.5 && distFromLast < 5.0) {
        _stationaryTicks++;
      } else {
        _stationaryTicks = 0;
      }

      if (_currentState == TrackingState.WALKING) {
        if (speed < 0.6 || _stationaryTicks > 3) { 
          if (secondsInCurrentState > 30 || _stationaryTicks > 5) targetState = TrackingState.STOPPED;
        } else {
          if (speed > 0.8) _lastStateChangeTime = DateTime.now();
          if (speedKmh > 18) targetState = TrackingState.DRIVING;
        }
      } else if (_currentState == TrackingState.STOPPED || _currentState == TrackingState.DEEP_SLEEP) {
        if (speed > 0.8 || distFromLast > 8.0) { 
          _highSpeedTicks++;
          final requiredTicks = (_currentState == TrackingState.DEEP_SLEEP) ? 1 : 2;
          if (_highSpeedTicks >= requiredTicks) targetState = TrackingState.WALKING;
        } else {
          _highSpeedTicks = 0;
          if (pos.accuracy < 25) _lastStateChangeTime = DateTime.now().subtract(Duration(seconds: secondsInCurrentState));
        }
      } else if (_currentState == TrackingState.DRIVING) {
        if (speedKmh < 10 || _stationaryTicks > 3) {
          if (secondsInCurrentState > 30 || _stationaryTicks > 5) targetState = TrackingState.WALKING;
        } else {
          if (speedKmh > 15) _lastStateChangeTime = DateTime.now();
        }
      }

      if (targetState != _currentState && _currentState != TrackingState.BATT_SAVER) {
        _log('STATE', 'Hysteresis -> $targetState (speed=${speed.toStringAsFixed(1)}m/s)');
        _setState(targetState, reason: 'Hysteresis ($speedKmh km/h)');
        // NO RETORNAR AQUÍ. Si retornamos, el punto que causó el cambio de estado se pierde para la UI y el buffer.
        // El _setState ya se encarga de aplicar wakelock y reiniciar stream si es necesario.
      }

      _lastSentGpsState = 'OK'; 
      
      // ✅ Detección unificada de GAP (20 min)
      String pointType = 'normal';
      if (_lastValidPoint != null) {
        final gap = pointTime.millisecondsSinceEpoch - _lastValidPoint!.timestamp;
        if (gap > _gapThresholdMs) {
          pointType = 'recovery';
          _log('GAP', 'Gap detectado: ${gap~/60000} min. Marcando como RECOVERY.');
        }
      }

      final batteryLevel = await _battery.batteryLevel;
      final batteryState = await _battery.batteryState;
      final isCharging = batteryState == BatteryState.charging || batteryState == BatteryState.full;

      final point = LocalPoint(
        lat: smoothedLat,
        lng: smoothedLng,
        speed: speedKmh,
        accuracy: pos.accuracy,
        state: _currentState.name,
        timestamp: pointTime.millisecondsSinceEpoch, // ✅ FIX: Tiempo del sensor, no de la CPU
        employeeId: _cachedEmployeeId,
        source: source,
        batteryLevel: batteryLevel,
        isCharging: isCharging,
        pointType: pointType,
      );

      // --- Gestión de Buffer Offline ---
      // ZUPT: solo descartar drift GPS si el estado confirma que estamos parados
      // Si el estado es WALKING, DRIVING, BATT_SAVER → dejar pasar siempre
      // Si _lastValidPoint es null (primer punto) → dejar pasar siempre para arrancar
      final isStationaryState = _currentState == TrackingState.STOPPED ||
                                 _currentState == TrackingState.DEEP_SLEEP;
      if (_motionDetector.isStationary && speed < 0.5 && isStationaryState && _lastValidPoint != null) {
        // Calcular distancia acumulada de los últimos puntos del buffer
        double accumulatedDist = 0.0;
        if (_pointBuffer.length >= 2) {
          for (int i = 1; i < _pointBuffer.length && i <= 10; i++) {
            accumulatedDist += Geolocator.distanceBetween(
              _pointBuffer[i - 1].lat, _pointBuffer[i - 1].lng,
              _pointBuffer[i].lat, _pointBuffer[i].lng,
            );
          }
        }
        // Si en los últimos puntos se movió >15m, el ZUPT es un falso positivo
        if (accumulatedDist > 15.0) {
          _log('ZUPT', 'ZUPT ignorado: movimiento acumulado real ${accumulatedDist.toStringAsFixed(1)}m (tráfico lento / bici)');
        } else {
          _log('ZUPT', 'Punto descartado: acelerómetro confirma quietud (drift GPS)');
          _isProcessingPosition = false;
          return;
        }
      }
      await _addToBufferAndFlush(point.toJson());

      // --- EMISIÓN EN TIEMPO REAL (SOCKET) ---
      // Deshabilitado — todo va por HTTP batch para evitar desincronización en 3G
      // _emitToSocket solo existe para compatibilidad con comandos remotos

      // --- GUARDADO PARA HISTORIAL (BUFFER) — FIX S3 ---
      // ANTERIOR: _lastValidPoint solo se actualizaba dentro del bloque isGoodForHistory.
      // → Si llegaban 5+ puntos malos seguidos, la referencia se congelaba y el spike filter
      //   rechazaba los puntos buenos siguientes (los comparaba contra posición de 30–60s atrás).
      // NUEVO: _lastValidPoint se actualiza SIEMPRE para mantener la referencia fresca.
      //        El buffer de historial (ruta) sigue tomando solo puntos de calidad.

      if (isGoodForHistory) {
        _pointBuffer.add(point);

        if (_pointBuffer.length >= 5) {
          _flushBufferToStorage().then((_) => _syncLoop(reason: 'Buffer Full'));
        }

        // Distancia solo con puntos buenos (sin ruido)
        if (_lastValidPoint != null) {
          final d = Geolocator.distanceBetween(
            _lastValidPoint!.lat, _lastValidPoint!.lng,
            point.lat, point.lng,
          );
          if (d > 5 && d < 1000) _totalDistanceKm += (d / 1000.0);
        }
      } else {
        _log('GPS', 'Punto excluido de Historial (acc: ${pos.accuracy.toStringAsFixed(1)}m)');
      }

      // 🔍 LOG TEMPORAL S3 — detectar congelamiento de referencia (eliminar tras verificación)
      if (_lastValidPoint != null) {
        final refAge = pointTime.millisecondsSinceEpoch - _lastValidPoint!.timestamp;
        final refDist = Geolocator.distanceBetween(
          _lastValidPoint!.lat, _lastValidPoint!.lng, point.lat, point.lng);
        final frozen = !isGoodForHistory && refAge > 10000;
        _log('LVP', '${frozen ? "⚠️ REF CONGELADA" : "✅ ref ok"} '
            'age=${(refAge/1000).toStringAsFixed(0)}s '
            'dist_desde_ref=${refDist.toStringAsFixed(1)}m '
            'goodHist=$isGoodForHistory '
            'acc=${pos.accuracy.toStringAsFixed(1)}m');
      }

      // FIX S3: Actualizar referencia con CUALQUIER punto válido
      _lastValidPoint = point;

      // Emitir al UI inmediatamente si es relevante
      _serviceInstance?.invoke('trackingLocation', {
        'lat': point.lat,
        'lng': point.lng,
        'speed': speedKmh,
        'state': _currentState.name,
        'total_distance': _totalDistanceKm,
      });
      _log('UI-NOTIF', 'Evento enviado a la UI: lat=${point.lat}, state=${_currentState.name}');

      // ✅ Actualizar el watchdog timer para evitar falsos positivos de NO_SIGNAL
      _lastValidLocationTime = pointTime;

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

  // Backoff exponencial con jitter: evita que todos los dispositivos reintenten al mismo tiempo
  // Secuencia: 15s, 30s, 60s, 120s, 300s (máx 5 min)
  static const List<int> _backoffSteps = [15, 30, 60, 120, 300];
  int _backoffIndex = 0;
  int _consecutiveFailures = 0;

  Duration get _nextBackoff {
    final base = _backoffSteps[_backoffIndex.clamp(0, _backoffSteps.length - 1)];
    // Jitter ±20% para evitar thundering herd si hay muchos dispositivos
    final jitter = (base * 0.2 * (DateTime.now().millisecond / 1000)).round();
    return Duration(seconds: base + jitter);
  }

  Future<void> _syncLoop({String reason = 'unknown'}) async {
    if (_isSyncing) return;
    if (_cachedToken == null) {
      _log('SYNC', 'Bloqueado: sin token');
      return;
    }

    // Respetar backoff solo si hay fallos previos
    if (_consecutiveFailures > 0 && DateTime.now().isBefore(_nextSyncAttempt)) {
      _log('SYNC', 'Backoff activo (fallo #$_consecutiveFailures). Reintento en ${_nextSyncAttempt.difference(DateTime.now()).inSeconds}s');
      return;
    }

    _isSyncing = true;

    // Verificación doble de conectividad antes de gastar recursos
    if (!_isOnline) {
      _log('SYNC', 'Sin red — abortando sync, esperando evento de reconexión');
      _isSyncing = false;
      return;
    }

    // BUG #9 FIX: una sola query al inicio en lugar de dos por iteración
    final initialPending = await _storage.getUnsyncedCount();
    _log('SYNC', '▶ Sync ($reason) — pendientes: $initialPending');
    if (initialPending == 0) {
      _isSyncing = false;
      return;
    }

    try {
      int batchesOk = 0;

      while (true) {
        final pending = await _storage.getUnsyncedCount();
        final batchSize = pending > 500 ? 100 : (pending > 100 ? 75 : 50);

        final unsynced = await _storage.getUnsyncedPoints(limit: batchSize);
        if (unsynced.isEmpty) {
          _log('SYNC', '✅ Sync completo ($batchesOk batches enviados)');
          _backoffIndex = 0;
          _consecutiveFailures = 0;
          break;
        }

        final data = unsynced.map((p) => {
          'client_id': p.clientId,
          'lat': p.lat, 'lng': p.lng,
          'speed': p.speed, 'accuracy': p.accuracy,
          'state': p.state, 'timestamp': p.timestamp,
          'source': p.source ?? 'gps',
          'point_type': p.pointType ?? 'normal',
          'is_manual_request': p.pointType == 'manual',
          'battery': p.batteryLevel,
          'is_charging': p.isCharging,
        }).toList();

        final ok = await _api.uploadBatch(data);

        if (ok) {
          final ids = unsynced.map((p) => p.id!).toList();
          await _storage.markPointsAsSynced(ids);
          _nextSyncAttempt = DateTime.now();
          _backoffIndex = 0;
          _consecutiveFailures = 0;
          batchesOk++;
          _log('SYNC', 'Batch $batchesOk OK (${unsynced.length} pts). Pendientes: ${pending - unsynced.length}');

          // Límite de seguridad: máx 200 batches por ciclo (evita bloquear el isolate)
          if (batchesOk >= 200) {
            _log('SYNC', 'Límite de ciclo alcanzado. Continuará en el próximo tick.');
            break;
          }

          // Pausa mínima entre batches para no saturar el servidor ni la CPU
          await Future.delayed(const Duration(milliseconds: 100));
        } else {
          _consecutiveFailures++;
          _backoffIndex = (_backoffIndex + 1).clamp(0, _backoffSteps.length - 1);
          final delay = _nextBackoff;
          _nextSyncAttempt = DateTime.now().add(delay);
          _log('SYNC', '❌ Fallo #$_consecutiveFailures. Reintento en ${delay.inSeconds}s');
          break;
        }
      }
    } catch (e) {
      _consecutiveFailures++;
      _backoffIndex = (_backoffIndex + 1).clamp(0, _backoffSteps.length - 1);
      _nextSyncAttempt = DateTime.now().add(_nextBackoff);
      _log('SYNC', 'Error crítico: $e');
    } finally {
      _isSyncing = false;
    }
  }

  /// Guarda el punto en SQLite. El envío al servidor lo hace _syncLoop.
  /// Esto elimina las peticiones HTTP concurrentes que causaban recorridos erráticos.
  Future<void> _addToBufferAndFlush(Map<String, dynamic> point) async {
    _log('BUFFER-ADD', 'Guardando punto en Storage: lat=${point['lat']}, source=${point['source']}');
    try {
      final lp = LocalPoint(
        lat: (point['lat'] as num).toDouble(),
        lng: (point['lng'] as num).toDouble(),
        speed: (point['speed'] as num?)?.toDouble() ?? 0,
        accuracy: (point['accuracy'] as num?)?.toDouble() ?? 99,
        state: point['state']?.toString() ?? 'STOPPED',
        timestamp: (point['timestamp'] as num).toInt(),
        employeeId: _cachedEmployeeId,
        source: point['source']?.toString(),
        pointType: point['point_type']?.toString() ?? 'normal',
        batteryLevel: (point['battery'] as num?)?.toInt(),
        isCharging: point['is_charging'] as bool?,
      );
      await _storage.insertPoints([lp]);
    } catch (e) {
      _log('STORAGE', 'Error guardando punto en SQLite: $e');
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
      autoStart: true,  // Reinicia automáticamente si el OS mata el proceso o el teléfono se reinicia
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
  _globalServiceInstance = service;
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
          if (userId != null) {
            socket.emit('join_employee', userId);
          } else {
            _engine?._isManualSocketJoinPending = true; // Intentar después cuando tengamos ID
          }
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
