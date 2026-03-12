import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'services/background_service.dart';
import 'screens/auth_wrapper.dart';

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
