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
  LocalPoint? lastValidPoint;

  /// Función para detectar estado según velocidad
  String calculateState(double speedKmh) {
    if (speedKmh < 0.8) return "SIN_MOVIMIENTO";
    if (speedKmh < 4.0) return "CAMINANDO";
    if (speedKmh < 12.0) return "MOVIMIENTO_LENTO";
    return "VEHICULO";
  }

  /// Iniciar Stream de ubicación en tiempo real
  Geolocator.getPositionStream(
    locationSettings: AndroidSettings(
      accuracy: LocationAccuracy.bestForNavigation,
      distanceFilter: 5,
      intervalDuration: const Duration(seconds: 5),
      foregroundNotificationConfig: ForegroundNotificationConfig(
        notificationText: "Rastreando ubicación en tiempo real...",
        notificationTitle: "GPS Tracking Activo",
        enableWakeLock: true,
      ),
    ),
  ).listen((Position pos) async {
    try {
      final token = await api.getToken();
      if (token == null) return;

      final double speedKmh = pos.speed * 3.6;

      // 1. Filtrar por precisión basura (> 50m)
      if (pos.accuracy > 50) {
        print("[GPS] Punto descartado por baja precisión: ${pos.accuracy}m");
        return;
      }

      // 2. Filtrar por velocidad absurda (> 150 km/h)
      if (speedKmh > 150) {
        print("[GPS] Punto descartado por velocidad absurda: $speedKmh km/h");
        return;
      }

      // 3. Filtrar por salto imposible (> 300 km/h promedio desde último punto)
      if (lastValidPoint != null) {
        double dist = Geolocator.distanceBetween(
          lastValidPoint!.lat, lastValidPoint!.lng,
          pos.latitude, pos.longitude
        );
        double timeSecs = (DateTime.now().millisecondsSinceEpoch - lastValidPoint!.timestamp) / 1000.0;
        if (timeSecs > 0) {
          double avgSpeed = (dist / timeSecs) * 3.6;
          if (avgSpeed > 300) {
            print("[GPS] Salto imposible detectado: $avgSpeed km/h promedio. Descartando.");
            return;
          }
        }
      }

      final state = calculateState(speedKmh);

      final point = LocalPoint(
        lat: pos.latitude,
        lng: pos.longitude,
        speed: speedKmh,
        accuracy: pos.accuracy,
        state: state,
        timestamp: DateTime.now().millisecondsSinceEpoch,
      );

      // Guardar en BD local
      await storage.insertPoint(point);
      lastValidPoint = point;

      // Notificación de estado
      if (service is AndroidServiceInstance && await service.isForegroundService()) {
        final stats = await storage.getStats();
        service.setForegroundNotificationInfo(
          title: 'Estado: $state',
          content: 'Velocidad: ${speedKmh.toStringAsFixed(1)} km/h | Cola: ${stats['unsynced']}',
        );
      }

      // SUBIDA REAL-TIME: Enviar inmediatamente al servidor
      final ok = await api.uploadBatch([point.toJson()]);
      if (ok) {
        if (point.id != null) await storage.markPointsAsSynced([point.id!]);
      }

      // Limpiar datos antiguos cada 1 hora (en el minuto 0)
      if (DateTime.now().minute == 0 && DateTime.now().second < 10) {
        await storage.cleanOldSyncedPoints();
      }
    } catch (e) {
      print("[GPS] Error en stream: $e");
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
        'state': p.state,
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
