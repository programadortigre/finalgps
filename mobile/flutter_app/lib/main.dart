import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'services/background_service.dart';
import 'services/api_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));
  await initializeService();
  runApp(const GpsTrackerApp());
}

class GpsTrackerApp extends StatelessWidget {
  const GpsTrackerApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'GPS Tracker',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      fontFamily: 'Inter',
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1A1A2E)),
    ),
    home: const AuthWrapper(),
  );
}

// ─── Auth Wrapper ──────────────────────────────────────────────────────────────
class AuthWrapper extends StatefulWidget {
  const AuthWrapper({super.key});
  @override
  State<AuthWrapper> createState() => _AuthWrapperState();
}

class _AuthWrapperState extends State<AuthWrapper> {
  final _api = ApiService();
  bool _checking = true;
  String? _token;

  @override
  void initState() {
    super.initState();
    _api.getToken().then((t) => setState(() { _token = t; _checking = false; }));
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(
        backgroundColor: Color(0xFF1A1A2E),
        body: Center(child: CircularProgressIndicator(color: Colors.white)),
      );
    }
    return _token != null ? const TrackingScreen() : const LoginScreen();
  }
}

// ─── Login Screen (GeoZilla/Uber style) ───────────────────────────────────────
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with TickerProviderStateMixin {
  final _emailCtrl = TextEditingController();
  final _passCtrl  = TextEditingController();
  final _urlCtrl   = TextEditingController();
  final _api = ApiService();
  bool _loading = false;
  bool _obscure = true;
  bool _showServerConfig = false;
  String? _selectedPreset;
  late AnimationController _fadeCtrl;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _fadeCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));
    _fadeAnim = CurvedAnimation(parent: _fadeCtrl, curve: Curves.easeOut);
    _fadeCtrl.forward();
    _loadServerUrl();
  }

  Future<void> _loadServerUrl() async {
    final url = await ApiService.getServerUrl();
    _urlCtrl.text = url;
    final match = kServerPresets.where((p) => p['url'] == url);
    if (match.isNotEmpty) {
      _selectedPreset = match.first['url'];
    } else {
      _selectedPreset = '__custom__';
    }
    if (mounted) setState(() {});
  }

  @override
  void dispose() { _fadeCtrl.dispose(); super.dispose(); }

  Future<void> _login() async {
    if (_emailCtrl.text.isEmpty || _passCtrl.text.isEmpty) {
      _snack('Ingresa tu email y contraseña');
      return;
    }
    if (_urlCtrl.text.isEmpty) {
      _snack('Configura la URL del servidor');
      return;
    }

    setState(() => _loading = true);

    await ApiService.setServerUrl(_urlCtrl.text.trim());
    _api.resetDio();

    await [Permission.location, Permission.notification].request();

    final token = await _api.login(_emailCtrl.text.trim(), _passCtrl.text);
    if (token == '__timeout__') {
      _snack('Sin conexión al servidor. Verifica la URL y tu red.');
      setState(() => _loading = false);
      return;
    }
    if (token != null) {
      if (await Permission.location.isGranted) await Permission.locationAlways.request();
      if (await Permission.ignoreBatteryOptimizations.isDenied) {
        await Permission.ignoreBatteryOptimizations.request();
      }
      await FlutterBackgroundService().startService();
      if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const TrackingScreen()));
    } else {
      _snack('Credenciales incorrectas');
      setState(() => _loading = false);
    }
  }

  void _snack(String msg) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating, backgroundColor: const Color(0xFF1A1A2E)),
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      body: FadeTransition(
        opacity: _fadeAnim,
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
            child: Column(children: [
              const SizedBox(height: 30),
              Container(
                width: 90, height: 90,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [Color(0xFF6C63FF), Color(0xFF3F8CFF)]),
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [BoxShadow(color: const Color(0xFF6C63FF).withOpacity(.4), blurRadius: 30, offset: const Offset(0, 12))],
                ),
                child: const Icon(Icons.location_on, color: Colors.white, size: 50),
              ),
              const SizedBox(height: 32),
              const Text('GPS Tracker Pro', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 6),
              const Text('Rastreo para vendedores en campo', style: TextStyle(fontSize: 14, color: Color(0xFF8B8FA8))),
              const SizedBox(height: 48),

              _inputField(
                controller: _emailCtrl,
                label: 'Correo electrónico',
                icon: Icons.email_outlined,
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 16),

              _inputField(
                controller: _passCtrl,
                label: 'Contraseña',
                icon: Icons.lock_outline,
                obscure: _obscure,
                onSubmit: (_) => _login(),
                suffix: IconButton(
                  icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility, color: const Color(0xFF8B8FA8)),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
              const SizedBox(height: 20),

              // ── Server URL Config (collapsible) ──
              GestureDetector(
                onTap: () => setState(() => _showServerConfig = !_showServerConfig),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.dns_outlined, color: Color(0xFF6C63FF), size: 16),
                    const SizedBox(width: 6),
                    const Text(
                      'Configurar servidor',
                      style: TextStyle(fontSize: 13, color: Color(0xFF6C63FF), fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(width: 4),
                    AnimatedRotation(
                      turns: _showServerConfig ? 0.5 : 0,
                      duration: const Duration(milliseconds: 200),
                      child: const Icon(Icons.keyboard_arrow_down, color: Color(0xFF6C63FF), size: 20),
                    ),
                  ],
                ),
              ),

              AnimatedCrossFade(
                firstChild: const SizedBox.shrink(),
                secondChild: Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Column(children: [
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF242740),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedPreset,
                          isExpanded: true,
                          dropdownColor: const Color(0xFF242740),
                          iconEnabledColor: const Color(0xFF6C63FF),
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          hint: const Text('Selecciona un servidor', style: TextStyle(color: Color(0xFF8B8FA8))),
                          items: [
                            ...kServerPresets.map((p) => DropdownMenuItem(
                              value: p['url'],
                              child: Text(p['label']!, style: const TextStyle(color: Colors.white)),
                            )),
                            const DropdownMenuItem(
                              value: '__custom__',
                              child: Text('✏️ URL personalizada', style: TextStyle(color: Colors.white)),
                            ),
                          ],
                          onChanged: (val) {
                            setState(() {
                              _selectedPreset = val;
                              if (val != null && val != '__custom__') {
                                _urlCtrl.text = val;
                              } else {
                                _urlCtrl.text = '';
                              }
                            });
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    _inputField(
                      controller: _urlCtrl,
                      label: 'URL del servidor',
                      icon: Icons.link,
                      keyboardType: TextInputType.url,
                    ),
                    const SizedBox(height: 8),
                    Row(children: [
                      Container(
                        width: 8, height: 8,
                        decoration: BoxDecoration(
                          color: _urlCtrl.text.isNotEmpty ? const Color(0xFF22C55E) : const Color(0xFFEF4444),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _urlCtrl.text.isNotEmpty
                            ? 'Apuntando a: ${_urlCtrl.text}'
                            : 'Sin servidor configurado',
                          style: TextStyle(
                            fontSize: 11,
                            color: _urlCtrl.text.isNotEmpty ? const Color(0xFF22C55E) : const Color(0xFFEF4444),
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ]),
                  ]),
                ),
                crossFadeState: _showServerConfig ? CrossFadeState.showSecond : CrossFadeState.showFirst,
                duration: const Duration(milliseconds: 300),
              ),

              const SizedBox(height: 28),

              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: _loading ? null : _login,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6C63FF),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                  child: _loading
                    ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                    : const Text('INICIAR SESIÓN', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: 1)),
                ),
              ),
              const SizedBox(height: 24),
              const Text('Al iniciar sesión, se activará el rastreo GPS en segundo plano.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Color(0xFF555875))),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _inputField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
    bool obscure = false,
    Widget? suffix,
    ValueChanged<String>? onSubmit,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      obscureText: obscure,
      onSubmitted: onSubmit,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF8B8FA8)),
        prefixIcon: Icon(icon, color: const Color(0xFF6C63FF), size: 20),
        suffixIcon: suffix,
        filled: true,
        fillColor: const Color(0xFF242740),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Color(0xFF6C63FF), width: 1.5),
        ),
      ),
    );
  }
}

// ─── Tracking Screen — Premium Dark UI (Uber / GeoZilla / Rappi style) ────────
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
  String  _state = "SIN_MOVIMIENTO";
  double  _distanceToday = 0;
  final Distance _distCalc = const Distance();

  List<LatLng> _trail = [];
  bool _isOnline = false;
  bool _followMe = true;
  StreamSubscription<Position>? _locationSub;

  // ─ User info ─
  String _userName = '';
  String _userRole = '';
  String _userInitials = '';

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
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 1))..repeat(reverse: true);
    _pulseAnim = Tween<double>(begin: 0.6, end: 1.0).animate(CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut));

    _slideCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 600));
    _slideAnim = CurvedAnimation(parent: _slideCtrl, curve: Curves.easeOutBack);
    _slideCtrl.forward();

    _loadUserInfo();
    _loadTodayRoute();
    _startListening();
  }

  Future<void> _loadTodayRoute() async {
    final routeData = await _api.fetchTodayRoute();
    if (routeData != null && mounted) {
      setState(() {
        _distanceToday = (routeData['distance_meters'] as num?)?.toDouble() ?? 0.0;
        _distanceToday = _distanceToday / 1000.0; // convert to km
        
        final points = routeData['points'] as List;
        _trail = points.map((p) => LatLng(
            (p['lat'] as num).toDouble(), 
            (p['lng'] as num).toDouble()
        )).toList();
      });
      // Move map to the last known point if available
      if (_trail.isNotEmpty && _followMe) {
         _mapCtrl.move(_trail.last, 16);
      }
    }
  }

  Future<void> _loadUserInfo() async {
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
      });
    }
  }

  @override
  void dispose() {
    _locationSub?.cancel();
    _clockTimer?.cancel();
    _pulseCtrl.dispose();
    _slideCtrl.dispose();
    super.dispose();
  }

  void _startListening() {
    _locationSub = Geolocator.getPositionStream(
      locationSettings: const AndroidSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: 5,
        intervalDuration: Duration(seconds: 5),
      ),
    ).listen((pos) {
      final ll = LatLng(pos.latitude, pos.longitude);
      if (mounted) {
        setState(() {
          _speed    = pos.speed * 3.6;
          _accuracy = pos.accuracy;
          
          // Detección simple para la UI (consistente con el background)
          if (_speed < 0.8) {
            _state = "SIN_MOVIMIENTO";
          } else if (_speed < 4.0) {
            _state = "CAMINANDO";
          } else if (_speed < 12.0) {
            _state = "MOVIMIENTO_LENTO";
          } else {
            _state = "VEHICULO";
          }

          if (_position != null && _isOnline) {
            _distanceToday += _distCalc.as(LengthUnit.Kilometer, _position!, ll);
            _trail.add(ll);
          }
          _position = ll;
        });
        if (_followMe) _mapCtrl.move(ll, _mapCtrl.camera.zoom);
      }
    });
  }

  void _startClock() {
    _sessionStart = DateTime.now();
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

  void _stopClock() {
    _clockTimer?.cancel();
    _clockTimer = null;
  }

  Future<void> _toggleOnline() async {
    setState(() => _isOnline = !_isOnline);
    if (_isOnline) {
      _startClock();
      await FlutterBackgroundService().startService();
    } else {
      _stopClock();
      FlutterBackgroundService().invoke('stopService');
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
            // Route trail with glow effect
            if (_trail.length > 1) ...[
              PolylineLayer(polylines: [
                Polyline(points: _trail, color: const Color(0xFF6C63FF).withOpacity(.25), strokeWidth: 14),
                Polyline(points: _trail, color: const Color(0xFF6C63FF), strokeWidth: 4, borderColor: const Color(0xFF3F8CFF), borderStrokeWidth: 1),
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

                // ── Toggle Tracking Button ──
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
                ),
              ]),
            ),
          ),
        ),
      ]),
    );
  }

  // ── Glass-style action button ──
  Widget _glassBtn(IconData icon, VoidCallback onTap) => Material(
    color: Colors.white.withOpacity(.12),
    borderRadius: BorderRadius.circular(14),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        width: 42, height: 42,
        alignment: Alignment.center,
        child: Icon(icon, size: 20, color: Colors.white.withOpacity(.9)),
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
