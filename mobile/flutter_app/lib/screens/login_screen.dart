import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import 'tracking_screen.dart';

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
      await SocketService.init(token);
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
