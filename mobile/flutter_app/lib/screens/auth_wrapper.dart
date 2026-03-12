import 'package:flutter/material.dart';
import '../services/api_service.dart';
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
