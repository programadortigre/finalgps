import 'dart:async';
import 'dart:ui';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:geolocator/geolocator.dart';
import 'api_service.dart';
import 'local_storage.dart';
import '../models/local_point.dart';

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
  final storage = LocalStorage();
  List<Map<String, dynamic>> cache = [];

  /// Timer principal: Capturar GPS cada 15 segundos
  Timer.periodic(const Duration(seconds: 15), (timer) async {
    try {
      final token = await api.getToken();
      if (token == null) {
        timer.cancel();
        await service.stopSelf();
        return;
      }

      if (service is AndroidServiceInstance && await service.isForegroundService()) {
        final stats = await storage.getStats();
        service.setForegroundNotificationInfo(
          title: 'GPS Tracking Activo',
          content: 'Última actualización: ${DateTime.now().toString().substring(11, 19)} '
              '(${stats['unsynced']} en cola)',
        );
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      final point = LocalPoint(
        lat: pos.latitude,
        lng: pos.longitude,
        speed: pos.speed * 3.6,
        accuracy: pos.accuracy,
        timestamp: DateTime.now().millisecondsSinceEpoch,
      );

      // PASO CRÍTICO: Guardar SIEMPRE en BD local primero
      // Esto garantiza que NO se pierdan puntos nunca
      await storage.insertPoint(point);

      // También agregar a cache en RAM para upload inmediato si hay conexión
      cache.add({
        'lat': point.lat,
        'lng': point.lng,
        'speed': point.speed,
        'accuracy': point.accuracy,
        'timestamp': point.timestamp,
      });

      // Si tenemos 20 puntos en RAM, intentar enviar
      if (cache.length >= 20) {
        final ok = await api.uploadBatch(cache);
        if (ok) {
          cache.clear();
          // Marcar como sincronizados en BD local
          final unsyncedPoints = await storage.getUnsyncedPoints(limit: 20);
          final ids = unsyncedPoints.map((p) => p.id!).toList();
          if (ids.isNotEmpty) {
            await storage.markPointsAsSynced(ids);
          }
        }
      }

      // Limpiar datos antiguos cada 1 hora
      if (DateTime.now().minute == 0) {
        await storage.cleanOldSyncedPoints();
      }
    } catch (e) {
      // Los puntos ya están guardados localmente - esto es seguro
      // El error se reintentará en 5 minutos
    }
  });

  /// Timer de reintento: Intentar enviar puntos no sincronizados cada 5 minutos
  /// Esto permite offset automático cuando se recupera la conexión
  Timer.periodic(const Duration(minutes: 5), (timer) async {
    try {
      final token = await api.getToken();
      if (token == null) return;  // Sin conexión o logout

      final unsyncedPoints = await storage.getUnsyncedPoints(limit: 100);
      if (unsyncedPoints.isEmpty) return;  // Nada que enviar

      final data = unsyncedPoints.map((p) => {
        'lat': p.lat,
        'lng': p.lng,
        'speed': p.speed,
        'accuracy': p.accuracy,
        'timestamp': p.timestamp,
      }).toList();

      final ok = await api.uploadBatch(data);
      if (ok) {
        // Éxito: marcar como sincronizados
        final ids = unsyncedPoints.map((p) => p.id!).toList();
        await storage.markPointsAsSynced(ids);
      }
      // Si falla: reintentar en 5 minutos más
    } catch (e) {
      // Reintentar la próxima vez
    }
  });

  service.on('stopService').listen((_) => service.stopSelf());
}
