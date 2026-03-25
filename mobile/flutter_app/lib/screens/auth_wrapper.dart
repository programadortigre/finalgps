import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import 'tracking_screen.dart';
import 'login_screen.dart';

class AuthWrapper extends StatefulWidget {
  const AuthWrapper({super.key});
  @override
  State<AuthWrapper> createState() => _AuthWrapperState();
}

class _AuthWrapperState extends State<AuthWrapper> {
  final _api = ApiService();
  bool _checking = true;
  String? _token;
  static const platform = MethodChannel('com.example.flutter_gps_tracker/battery');

  @override
  void initState() {
    super.initState();
    _requestBatteryOptimizerExemption();
    _api.getToken().then((t) async {
      if (t != null) {
        // Token existe → vendedor ya hizo login antes
        // Arrancar servicio automáticamente (puede que el OS lo haya matado)
        final service = FlutterBackgroundService();
        final isRunning = await service.isRunning();
        if (!isRunning) {
          await service.startService();
        }
        SocketService.init(t);
        // Enviar ubicación inmediata al abrir la app con sesión activa
        _sendImmediateLocation(t);
      }
      if (mounted) setState(() { _token = t; _checking = false; });
    });
  }

  Future<void> _sendImmediateLocation(String token) async {
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
      final now = DateTime.now().millisecondsSinceEpoch;
      await _api.uploadBatch([{
        'lat': pos.latitude,
        'lng': pos.longitude,
        'speed': pos.speed * 3.6,
        'accuracy': pos.accuracy,
        'state': 'STOPPED',
        'timestamp': now,
        'point_type': 'manual',
        'source': 'app_open',
        'is_manual_request': true,
      }]);
      print('[AUTH] Ubicación inmediata enviada al abrir app');
    } catch (e) {
      print('[AUTH] No se pudo enviar ubicación inmediata: $e');
    }
  }

  // Solicitar exención de optimización de batería
  Future<void> _requestBatteryOptimizerExemption() async {
    try {
      final result = await platform.invokeMethod<bool>('requestBatteryExemption');
      print('[AUTH] Battery exemption requested: $result');
    } on PlatformException catch (e) {
      print('[AUTH] Battery exemption error: ${e.message}');
    }
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
