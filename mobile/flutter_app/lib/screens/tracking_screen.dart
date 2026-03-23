import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';
import '../services/api_service.dart';
import 'auth_wrapper.dart';
import 'admin_monitoring_screen.dart';
import 'route_screen.dart';

class TrackingScreen extends StatefulWidget {
  const TrackingScreen({super.key});
  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> with TickerProviderStateMixin {
  final MapController _mapCtrl = MapController();
  final _api = ApiService();

  // ─ Location state ─
  LatLng? _position;
  double  _speed = 0;
  double  _accuracy = 0;
  String  _state = "Quieto";
  
  void _log(String tag, String msg) => debugPrint('[$tag] $msg');
  double  _distanceToday = 0;
  final Distance _distCalc = const Distance();

  List<List<LatLng>> _segments = [[]];
  bool _isOnline = false;
  bool _isProcessing = false; // Bloqueo de UI durante cambios de estado
  bool _followMe = true;
  DateTime? _lastHeartbeat;    // Último pulso recibido del servicio
  bool _serviceConnected = true; 
  StreamSubscription<Map<String, dynamic>?>? _stateSub;
  StreamSubscription<Map<String, dynamic>?>? _locationEventSub;
  StreamSubscription<Map<String, dynamic>?>? _heartbeatSub;
  Timer? _healthCheckTimer;    // Monitor de heartbeat

  // ─ User info ─
  String _userName = '';
  String _userRole = '';
  String _userInitials = '';
  bool   _isAdmin = false;

  // ─ Timer ─
  DateTime? _sessionStart;
  Timer? _clockTimer;
  String _elapsed = '00:00:00';

  // ─ Animations ─
  late AnimationController _pulseCtrl;
  late Animation<double>   _pulseAnim;
  late AnimationController _slideCtrl;
  late Animation<double>   _slideAnim;

  @override
  void initState() {
    super.initState();
    _setupServiceListeners();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 1))..repeat(reverse: true);
    _pulseAnim = Tween<double>(begin: 0.6, end: 1.0).animate(CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut));

    _slideCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 600));
    _slideAnim = CurvedAnimation(parent: _slideCtrl, curve: Curves.easeOutBack);
    _slideCtrl.forward();

    _loadUserInfo();
    _loadTodayRoute();
  }

  void _setupServiceListeners() {
    final service = FlutterBackgroundService();
    
    // Check initial state
    service.isRunning().then((isRunning) {
      if (mounted) {
        setState(() {
          _isOnline = isRunning;
          if (isRunning) _lastHeartbeat = DateTime.now();
        });
        if (isRunning) _startClock();
      }
    });

    // Monitor de salud de la conexión con el servicio
    _healthCheckTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_isOnline && _lastHeartbeat != null) {
        final diff = DateTime.now().difference(_lastHeartbeat!).inSeconds;
        if (diff > 60) { // Timeout de 60s
           if (mounted && _serviceConnected) {
             setState(() => _serviceConnected = false);
             debugPrint('[UI] Heartbeat perdido > 60s. Posible servicio muerto.');
           }
        } else if (mounted && !_serviceConnected) {
          setState(() => _serviceConnected = true);
        }
      }
    });

    _heartbeatSub = service.on('heartbeat').listen((event) {
      if (mounted) {
        setState(() {
          _lastHeartbeat = DateTime.now();
          _serviceConnected = true;
          if (event != null && event['distance'] != null) {
             _distanceToday = (event['distance'] as num).toDouble();
          }
        });
      }
    });

    _stateSub = service.on('trackingState').listen((event) {
      if (event != null && mounted) {
        final active = event['is_active'] == true;
        setState(() {
          _isOnline = active;
          _isProcessing = false; // Liberar bloqueo
          if (active) _lastHeartbeat = DateTime.now();
        });
        if (active && _clockTimer == null) {
          _startClock();
        } else if (!active) {
          _stopClock();
        }
      }
    });

    _locationEventSub = service.on('trackingLocation').listen((event) {
      if (event != null && mounted) {
        setState(() {
          _speed = (event['speed'] as num?)?.toDouble() ?? 0.0;
          _accuracy = (event['accuracy'] as num?)?.toDouble() ?? 0.0;
          
          // Mapeo amigable para UI
          final rawState = event['state'] ?? 'STOPPED';
          if (rawState == 'STOPPED' || rawState == 'DEEP_SLEEP') _state = 'Quieto';
          else if (rawState == 'IDLE_ENGINE') _state = 'En Tráfico';
          else if (rawState == 'WALKING') _state = 'A pie';
          else if (rawState == 'DRIVING') _state = 'En auto';
          else if (rawState == 'NO_SIGNAL') _state = 'Sin Señal';
          else if (rawState == 'PAUSED') _state = 'Pausado (Admin)';
          else _state = rawState;

          if (event['lat'] != null && event['lng'] != null) {
            final ll = LatLng((event['lat'] as num).toDouble(), (event['lng'] as num).toDouble());
            
            // Sincronizar distancia si viene del servicio (Source of Truth)
            if (event['total_distance'] != null) {
               _distanceToday = (event['total_distance'] as num).toDouble();
            }

            // Persistir sessionStart si no existe y estamos online
            if (_isOnline && _sessionStart == null) {
               _restoreOrStartSession();
            }

            if (_isOnline) {
              // Optimización de segmentos: evitar múltiples vacíos y limitar puntos
              if (_segments.isEmpty) _segments.add([]);
              
              // Límite de puntos totales (2000 - FIX V3)
              int totalPoints = _segments.fold(0, (sum, seg) => sum + seg.length);
              if (totalPoints > 2000) {
                 _trimPoints(totalPoints - 2000 + 1);
              }

              if (_segments.last.isEmpty) {
                // ✅ FIX: Validar precisión del primer punto para evitar arañazos de ruido
                // Solo agregar si accuracy es decente (<50m) para descartar ruido GPS inicial
                if (_accuracy < 50) {
                  _segments.last.add(ll);
                  _log('GPS', 'Primer punto del segmento: acc=$_accuracy m');
                } else {
                  _log('FILTER', 'DROP primer punto: accuracy=$_accuracy m > 50m (ruido GPS)');
                }
              } else {
                final lastPoint = _segments.last.last;
                // Solo agregar si hay movimiento real (> 5m) para no saturar con ruido
                if (_distCalc.as(LengthUnit.Meter, lastPoint, ll) > 5) {
                  _segments.last.add(ll);
                } else {
                  _log('FILTER', 'DROP: distancia=${_distCalc.as(LengthUnit.Meter, lastPoint, ll).toStringAsFixed(1)}m < 5m');
                }
              }
            }
            
            _position = ll;
            // Validar MapController antes de mover
            if (_followMe) {
               try {
                  // zoom actual
                  final currentZoom = _mapCtrl.camera.zoom;
                  _mapCtrl.move(ll, currentZoom);
               } catch(e) {
                  debugPrint('MapController not ready: $e');
               }
            }
          }
        });
      }
    });
  }

  // Elimina puntos antiguos para mantener rendimiento (Límite 2000 pts)
  void _trimPoints(int countToBlob) {
    int removed = 0;
    while (removed < countToBlob && _segments.isNotEmpty) {
      if (_segments.first.isNotEmpty) {
        _segments.first.removeAt(0);
        removed++;
      } else {
        _segments.removeAt(0);
        if (_segments.isEmpty) _segments.add([]);
      }
    }
  }

  Future<void> _restoreOrStartSession({bool forceReset = false}) async {
    // No restaurar si no estamos online realmente
    if (!_isOnline && !forceReset) return;

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getInt('session_start_ms');
    
    if (saved != null && !forceReset) {
      final startTime = DateTime.fromMillisecondsSinceEpoch(saved);
      // TTL de 12 horas: Si la sesión es más vieja, se limpia.
      if (DateTime.now().difference(startTime).inHours < 12) {
        _sessionStart = startTime;
      } else {
        await prefs.remove('session_start_ms');
        _sessionStart = DateTime.now();
        await prefs.setInt('session_start_ms', _sessionStart!.millisecondsSinceEpoch);
      }
    } else {
      _sessionStart = DateTime.now();
      await prefs.setInt('session_start_ms', _sessionStart!.millisecondsSinceEpoch);
    }
  }

  Future<void> _loadTodayRoute() async {
    try {
      final routes = await _api.fetchTodayRoutes();
      if (routes != null && mounted) {
        setState(() {
          _distanceToday = 0;
          _segments.clear();
          for (var r in routes) {
             _distanceToday += (r['distance_meters'] as num? ?? 0).toDouble() / 1000.0;
             final pts = r['points'] as List;
             if (pts.isNotEmpty) {
               _segments.add(pts.map((p) => LatLng(
                   (p['lat'] as num).toDouble(), 
                   (p['lng'] as num).toDouble()
               )).toList());
             }
          }
          
          if (_segments.isEmpty) _segments.add([]);

          if (_segments.isNotEmpty && _segments.last.isNotEmpty && _followMe) {
             _mapCtrl.move(_segments.last.last, 16);
          }
        });
      }
    } catch (e) {
      debugPrint('Error cargando ruta de hoy: $e');
    }
  }

  Future<void> _loadUserInfo() async {
    try {
      final name = await _api.getUserName() ?? 'Usuario';
      final role = await _api.getUserRole() ?? '';
      final parts = name.trim().split(' ');
      final initials = parts.length >= 2
          ? '${parts[0][0]}${parts[1][0]}'.toUpperCase()
          : name.isNotEmpty ? name[0].toUpperCase() : 'U';
      if (mounted) {
        setState(() {
          _userName = name;
          _userRole = role;
          _userInitials = initials;
          _isAdmin = role.toLowerCase() == 'admin';
        });
      }
    } catch (e) {
      debugPrint('Error cargando info de usuario: $e');
    }
  }

  @override
  void dispose() {
    _stateSub?.cancel();
    _locationEventSub?.cancel();
    _heartbeatSub?.cancel();
    _healthCheckTimer?.cancel();
    _clockTimer?.cancel();
    _pulseCtrl.dispose();
    _slideCtrl.dispose();
    super.dispose();
  }

  // Locals removed: we react to events now instead of Geolocator.

  void _startClock({bool forceReset = false}) async {
    if (_sessionStart == null || forceReset) {
      await _restoreOrStartSession(forceReset: forceReset);
    }
    _clockTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_sessionStart != null && mounted) {
        final diff = DateTime.now().difference(_sessionStart!);
        setState(() {
          _elapsed = '${diff.inHours.toString().padLeft(2, '0')}:'
              '${(diff.inMinutes % 60).toString().padLeft(2, '0')}:'
              '${(diff.inSeconds % 60).toString().padLeft(2, '0')}';
        });
      }
    });
  }

  void _stopClock() async {
    _clockTimer?.cancel();
    _clockTimer = null;
    _sessionStart = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('session_start_ms');
  }

  Future<void> _toggleOnline() async {
    if (_isProcessing) return; // Protección contra double-tap

    final service = FlutterBackgroundService();
    var isRunning = await service.isRunning();
    
    setState(() => _isProcessing = true);

    if (!isRunning) {
      if (_segments.isEmpty || (_segments.isNotEmpty && _segments.last.isNotEmpty)) {
        setState(() => _segments.add([])); // New segment only if last is not empty
      }
      
      // Permiso de notificaciones (Android 13+)
      await Permission.notification.request();

      // Solicitar permisos críticos antes de arrancar el servicio (No se puede hacer en el isolate)
      if (await Permission.locationAlways.request().isDenied) {
        if (mounted) {
           ScaffoldMessenger.of(context).showSnackBar(
             const SnackBar(content: Text('Se requiere permiso de ubicación "Siempre" para el rastreo.'))
           );
        }
        setState(() => _isProcessing = false);
        return;
      }

      if (await Permission.activityRecognition.request().isDenied) {
        _log('ACTIVITY', 'Permiso de actividad denegado — el ahorro de batería será menos agresivo');
      }

      final success = await service.startService();
      if (success) {
        // ✅ Sincronizar estado con el servidor
        await _api.updateTrackingStatus(true);
        _startClock(forceReset: true); // 🔥 Reset timer on manual start

        // Recordatorio de optimización de batería
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Recomendado: Desactiva "Optimización de batería" para este app en Ajustes.'),
              duration: Duration(seconds: 5),
              backgroundColor: Color(0xFF6C63FF),
            )
          );
        }
      } else {
        setState(() {
          _isOnline = false;
          _isProcessing = false;
        });
      }
    } else {
      service.invoke('stopService');
      _stopClock();
      
      // ✅ Sincronizar estado real con el servidor para que el Admin Panel vea el cambio de toggle
      try {
        await _api.updateTrackingStatus(false); 
      } catch (e) {
        debugPrint('Error notifying offline tracking status: $e');
      }
    }
  }

  Future<void> _logout() async {
    _stopClock();
    FlutterBackgroundService().invoke('stopService');
    await _api.logout();
    if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const AuthWrapper()));
  }

  String _roleLabel(String role) {
    switch (role.toLowerCase()) {
      case 'admin': return 'Administrador';
      case 'vendor': return 'Vendedor';
      case 'supervisor': return 'Supervisor';
      default: return role.isNotEmpty ? role : 'Vendedor';
    }
  }

  @override
  Widget build(BuildContext context) {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    final bottomPad = MediaQuery.of(context).padding.bottom;

    return Scaffold(
      extendBodyBehindAppBar: true,
      body: Stack(children: [
        // ── Full-screen Dark Map ──
        FlutterMap(
          mapController: _mapCtrl,
          options: MapOptions(
            initialCenter: _position ?? const LatLng(-12.0464, -77.0428),
            initialZoom: 16,
            onPositionChanged: (_, hasGesture) { if (hasGesture) setState(() => _followMe = false); },
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              subdomains: const ['a', 'b', 'c', 'd'],
              userAgentPackageName: 'com.example.flutter_gps_tracker',
            ),
            // Route trail segments with glow effect
            if (_segments.any((s) => s.length > 1)) ...[
              PolylineLayer(polylines: [
                for (var seg in _segments.where((s) => s.length > 1))
                  Polyline(points: seg, color: const Color(0xFF6C63FF).withOpacity(.25), strokeWidth: 14),
                for (var seg in _segments.where((s) => s.length > 1))
                  Polyline(points: seg, color: const Color(0xFF6C63FF), strokeWidth: 4, borderColor: const Color(0xFF3F8CFF), borderStrokeWidth: 1),
              ]),
            ],
            // My position marker
            if (_position != null)
              MarkerLayer(markers: [
                Marker(
                  point: _position!,
                  width: 80, height: 80,
                  child: AnimatedBuilder(
                    animation: _pulseAnim,
                    builder: (_, __) => Stack(alignment: Alignment.center, children: [
                      // Outer pulse ring
                      Container(
                        width: 70 * _pulseAnim.value, height: 70 * _pulseAnim.value,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: (_isOnline ? const Color(0xFF6C63FF) : const Color(0xFF94A3B8)).withOpacity(.3),
                            width: 2,
                          ),
                        ),
                      ),
                      // Middle glow
                      Container(
                        width: 40, height: 40,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: (_isOnline ? const Color(0xFF6C63FF) : const Color(0xFF94A3B8)).withOpacity(.15),
                        ),
                      ),
                      // Inner dot
                      Container(
                        width: 18, height: 18,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: _isOnline
                              ? [const Color(0xFF6C63FF), const Color(0xFF3F8CFF)]
                              : [const Color(0xFF64748B), const Color(0xFF94A3B8)],
                          ),
                          border: Border.all(color: Colors.white, width: 3),
                          boxShadow: [
                            BoxShadow(
                              color: (_isOnline ? const Color(0xFF6C63FF) : const Color(0xFF64748B)).withOpacity(.6),
                              blurRadius: 12,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                      ),
                    ]),
                  ),
                ),
              ]),
          ],
        ),

        // ── "Buscando GPS" overlay when online but no position ──
        if (_isOnline && _position == null)
          Center(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.7),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white10),
              ),
              child: const Row(mainAxisSize: MainAxisSize.min, children: [
                SizedBox(
                  width: 14, height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF6C63FF)),
                ),
                SizedBox(width: 12),
                Text('Buscando señal GPS...', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500)),
              ]),
            ),
          ),

        // ── Top Bar (Glassmorphism) ──
        Positioned(
          top: 0, left: 0, right: 0,
          child: SlideTransition(
            position: Tween<Offset>(begin: const Offset(0, -1), end: Offset.zero).animate(_slideAnim),
            child: Container(
              padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 8, 16, 14),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    const Color(0xFF1A1A2E).withOpacity(.95),
                    const Color(0xFF1A1A2E).withOpacity(.7),
                    const Color(0xFF1A1A2E).withOpacity(0),
                  ],
                  stops: const [0, 0.7, 1],
                ),
              ),
              child: Row(children: [
                // Avatar
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [Color(0xFF6C63FF), Color(0xFF3F8CFF)]),
                    borderRadius: BorderRadius.circular(15),
                    boxShadow: [BoxShadow(color: const Color(0xFF6C63FF).withOpacity(.4), blurRadius: 12, offset: const Offset(0, 4))],
                  ),
                  child: Center(
                    child: Text(_userInitials, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
                  ),
                ),
                const SizedBox(width: 12),
                // Name & status
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _userName.isNotEmpty ? _userName : 'Cargando...',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Row(children: [
                        AnimatedBuilder(
                          animation: _pulseAnim,
                          builder: (_, __) => Container(
                            width: 8, height: 8,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: _isOnline ? const Color(0xFF22C55E) : const Color(0xFF64748B),
                              boxShadow: _isOnline ? [BoxShadow(color: const Color(0xFF22C55E).withOpacity(_pulseAnim.value), blurRadius: 6, spreadRadius: 1)] : [],
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          _isOnline ? 'En línea · ${_roleLabel(_userRole)}' : 'Desconectado · ${_roleLabel(_userRole)}',
                          style: TextStyle(
                            color: _isOnline ? const Color(0xFF22C55E) : const Color(0xFF64748B),
                            fontSize: 12, fontWeight: FontWeight.w500,
                          ),
                        ),
                      ]),
                    ],
                  ),
                ),
                // Action buttons
                _glassBtn(Icons.my_location_rounded, () {
                  if (_position != null) {
                    setState(() => _followMe = true);
                    _mapCtrl.move(_position!, 17);
                  }
                }),
                const SizedBox(width: 8),
                _glassBtn(Icons.route_outlined, () {
                   Navigator.push(context, MaterialPageRoute(builder: (_) => const RouteScreen()));
                }, color: const Color(0xFF22C55E)),
                if (_isAdmin) ...[
                  const SizedBox(width: 8),
                  _glassBtn(Icons.dashboard_customize_rounded, () {
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminMonitoringScreen()));
                  }, color: const Color(0xFF6C63FF)),
                ],
                const SizedBox(width: 8),
                _glassBtn(Icons.logout_rounded, _logout),
              ]),
            ),
          ),
        ),

        // ── Bottom Panel (Dark themed) ──
        Positioned(
          left: 0, right: 0, bottom: 0,
          child: SlideTransition(
            position: Tween<Offset>(begin: const Offset(0, 1), end: Offset.zero).animate(_slideAnim),
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A2E),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
                boxShadow: [
                  BoxShadow(color: Colors.black.withOpacity(.4), blurRadius: 30, offset: const Offset(0, -8)),
                ],
              ),
              padding: EdgeInsets.fromLTRB(20, 18, 20, bottomPad + 20),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                // Handle bar
                Container(
                  width: 40, height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(.15),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 20),

                // ── Stats Cards Row ──
                Row(children: [
                  _statCard('⚡', _speed.toStringAsFixed(0), 'km/h', const Color(0xFF6C63FF)),
                  const SizedBox(width: 10),
                  _statCard('🎭', _state.replaceAll('_', ' '), 'estado', const Color(0xFFF59E0B)),
                  const SizedBox(width: 10),
                  _statCard('🛣️', _distanceToday.toStringAsFixed(2), 'km hoy', const Color(0xFF22C55E)),
                ]),

                const SizedBox(height: 16),

                // ── Elapsed time (only when online) ──
                AnimatedCrossFade(
                  firstChild: const SizedBox.shrink(),
                  secondChild: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                    decoration: BoxDecoration(
                      color: const Color(0xFF242740),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFF6C63FF).withOpacity(.2)),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.timer_outlined, color: Color(0xFF6C63FF), size: 18),
                        const SizedBox(width: 10),
                        Text(
                          'Tiempo activo:  $_elapsed',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            fontFeatures: [FontFeature.tabularFigures()],
                          ),
                        ),
                      ],
                    ),
                  ),
                  crossFadeState: _isOnline ? CrossFadeState.showSecond : CrossFadeState.showFirst,
                  duration: const Duration(milliseconds: 300),
                ),

                SizedBox(height: _isOnline ? 16 : 0),

                // ── Toggle Tracking Button (admin only) / Status pill (employee) ──
                if (_isAdmin)
                  GestureDetector(
                    onTap: _toggleOnline,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 400),
                      curve: Curves.easeInOut,
                      width: double.infinity,
                      height: 62,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: _isOnline
                            ? [const Color(0xFFEF4444), const Color(0xFFDC2626)]
                            : [const Color(0xFF6C63FF), const Color(0xFF3F8CFF)],
                        ),
                        borderRadius: BorderRadius.circular(18),
                        boxShadow: [
                          BoxShadow(
                            color: (_isOnline ? const Color(0xFFEF4444) : const Color(0xFF6C63FF)).withOpacity(.4),
                            blurRadius: 20, offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 300),
                          child: Icon(
                            _isOnline ? Icons.stop_rounded : Icons.play_arrow_rounded,
                            key: ValueKey(_isOnline),
                            color: Colors.white, size: 30,
                          ),
                        ),
                        const SizedBox(width: 10),
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 300),
                          child: Text(
                            _isOnline ? 'DETENER RASTREO' : 'INICIAR RASTREO',
                            key: ValueKey(_isOnline),
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              letterSpacing: .8,
                            ),
                          ),
                        ),
                      ]),
                    ),
                  )
                else
                  // Indicador de solo lectura para vendedores — el admin controla el rastreo remotamente
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 400),
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 18),
                    decoration: BoxDecoration(
                      color: _isOnline
                        ? const Color(0xFF22C55E).withOpacity(.1)
                        : const Color(0xFF64748B).withOpacity(.1),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        color: _isOnline
                          ? const Color(0xFF22C55E).withOpacity(.3)
                          : const Color(0xFF64748B).withOpacity(.3),
                      ),
                    ),
                    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(
                        _isOnline ? Icons.gps_fixed : Icons.gps_off,
                        color: _isOnline ? const Color(0xFF22C55E) : const Color(0xFF64748B),
                        size: 22,
                      ),
                      const SizedBox(width: 10),
                      Text(
                        _isOnline ? 'Rastreo activo' : 'Rastreo pausado por administrador',
                        style: TextStyle(
                          color: _isOnline ? const Color(0xFF22C55E) : const Color(0xFF64748B),
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                    ]),
                  ),
              ]),
            ),
          ),
        ),
      ]),
    );
  }

  // ── Glass-style action button ──
  Widget _glassBtn(IconData icon, VoidCallback onTap, {Color? color}) => Material(
    color: color?.withOpacity(.2) ?? Colors.white.withOpacity(.12),
    borderRadius: BorderRadius.circular(14),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        width: 42, height: 42,
        alignment: Alignment.center,
        child: Icon(icon, size: 20, color: color ?? Colors.white.withOpacity(.9)),
      ),
    ),
  );

  // ── Stat card with colored accent ──
  Widget _statCard(String emoji, String value, String label, Color accent) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF242740),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withOpacity(.2), width: 1),
      ),
      child: Column(children: [
        Text(emoji, style: const TextStyle(fontSize: 20)),
        const SizedBox(height: 6),
        Text(
          value,
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: Colors.white,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(fontSize: 10, color: accent.withOpacity(.8), fontWeight: FontWeight.w500)),
      ]),
    ),
  );
}
