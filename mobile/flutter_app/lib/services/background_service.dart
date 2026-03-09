import 'dart:async';
import 'dart:ui';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:geolocator/geolocator.dart';
import 'api_service.dart';

/// Call from main() — notification channel created natively in MainActivity.kt
Future<void> initializeService() async {
  final service = FlutterBackgroundService();
  await service.configure(
    androidConfiguration: AndroidConfiguration(
      onStart: onStart,
      autoStart: false,             // Starts explicitly after login
      isForegroundMode: true,
      notificationChannelId: 'gps_tracking_channel', // Matches MainActivity.kt
      initialNotificationTitle: 'GPS Tracking Activo',
      initialNotificationContent: 'Iniciando rastreo...',
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
  DartPluginRegistrant.ensureInitialized();

  if (service is AndroidServiceInstance) {
    service.on('setAsForeground').listen((_) => service.setAsForegroundService());
    service.on('setAsBackground').listen((_) => service.setAsBackgroundService());
  }

  final api = ApiService();
  List<Map<String, dynamic>> cache = [];

  Timer.periodic(const Duration(seconds: 15), (timer) async {
    try {
      final token = await api.getToken();
      if (token == null) {
        timer.cancel();
        await service.stopSelf();
        return;
      }

      if (service is AndroidServiceInstance && await service.isForegroundService()) {
        service.setForegroundNotificationInfo(
          title: 'GPS Tracking Activo',
          content: 'Última actualización: ${DateTime.now().toString().substring(11, 19)}',
        );
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      cache.add({
        'lat': pos.latitude,
        'lng': pos.longitude,
        'speed': pos.speed * 3.6,
        'accuracy': pos.accuracy,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });

      if (cache.length >= 2) {
        final ok = await api.uploadBatch(cache);
        if (ok) cache.clear();
      }
    } catch (_) {
      // Silent retry
    }
  });

  service.on('stopService').listen((_) => service.stopSelf());
}
