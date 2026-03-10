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
      autoStart: true,              // Empezar automáticamente al encender o tras login
      isForegroundMode: true,
      notificationChannelId: 'gps_tracking_channel', 
      initialNotificationTitle: 'GPS Tracking Activo',
      initialNotificationContent: 'Rastreando ubicación en segundo plano...',
      foregroundServiceNotificationId: 888,
    ),
    iosConfiguration: IosConfiguration(
      autoStart: true,
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

  /// Función auxiliar para determinar el estado semántico basado en velocidad
  String calculateState(double speedKmh) {
    if (speedKmh >= 15) return 'EN_RUTA_VEHICULO';
    if (speedKmh >= 4 && speedKmh < 15) return 'MOVIMIENTO_LENTO';
    if (speedKmh >= 1 && speedKmh < 4) return 'EN_RUTA_CAMINANDO';
    return 'DETENIDO';
  }

  /// Timer principal: Capturar GPS cada 15 segundos
  Timer.periodic(const Duration(seconds: 15), (timer) async {
    try {
      final token = await api.getToken();
      if (token == null) {
        timer.cancel();
        await service.stopSelf();
        return;
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 10),
      );

      final double speedKmh = pos.speed * 3.6;
      final String state = calculateState(speedKmh);

      if (service is AndroidServiceInstance && await service.isForegroundService()) {
        final stats = await storage.getStats();
        service.setForegroundNotificationInfo(
          title: 'GPS Tracking: $state',
          content: 'Última actualización: ${DateTime.now().toString().substring(11, 19)} '
              '(${stats['unsynced']} en cola)',
        );
      }

      // Notificar a la UI (MapScreen)
      service.invoke('update', {
        'lat': pos.latitude,
        'lng': pos.longitude,
        'speed': speedKmh,
        'state': state,
      });

      final point = LocalPoint(
        lat: pos.latitude,
        lng: pos.longitude,
        speed: speedKmh,
        accuracy: pos.accuracy,
        timestamp: DateTime.now().millisecondsSinceEpoch,
        state: state,
      );

      // PASO CRÍTICO: Guardar SIEMPRE en BD local primero
      await storage.insertPoint(point);

      // Agregar a cache en RAM
      cache.add(point.toJson());

      // 🚀 OPTIMIZACIÓN: Si es el primer punto o llegamos a 5 (antes 20), subir inmediatamente
      if (cache.length >= 5 || cache.length == 1) {
        final ok = await api.uploadBatch(cache);
        if (ok) {
          final unsyncedPoints = await storage.getUnsyncedPoints(limit: cache.length);
          final ids = unsyncedPoints.map((p) => p.id!).toList();
          if (ids.isNotEmpty) await storage.markPointsAsSynced(ids);
          cache.clear();
        }
      }

      // Limpiar datos antiguos cada 1 hora
      if (DateTime.now().minute == 0) {
        await storage.cleanOldSyncedPoints();
      }
    } catch (e) {
      // Reintento silencioso vía el otro timer
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

      final data = unsyncedPoints.map((p) => p.toJson()).toList();

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
