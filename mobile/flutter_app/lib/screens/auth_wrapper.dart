import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
    _api.getToken().then((t) {
      if (t != null) SocketService.init(t);
      setState(() { _token = t; _checking = false; });
    });
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
