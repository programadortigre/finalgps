import 'dart:async';
import 'dart:ui';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:geolocator/geolocator.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'api_service.dart';
import 'local_storage.dart';
import '../models/local_point.dart';
import '../utils/kalman_filter.dart';

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

  // Activar wakelock para mantener CPU despierto
  WakelockPlus.enable();

  final api = ApiService();
  final storage = LocalStorage();
  LocalPoint? lastValidPoint;
  int lastUploadTime = 0;
  int stationaryTicks = 0;

  // 🧠 Inicializar filtro Kalman para suavizar coordenadas
  LocationKalmanFilter? locationFilter;

  /// Función para detectar estado según velocidad
  String calculateState(double speedKmh) {
    if (speedKmh < 0.8) return "SIN_MOVIMIENTO";
    if (speedKmh < 4.0) return "CAMINANDO";
    if (speedKmh < 12.0) return "MOVIMIENTO_LENTO";
    return "VEHICULO";
  }

  /// Iniciar Stream de ubicación en tiempo real con máxima precisión
  Geolocator.getPositionStream(
    locationSettings: AndroidSettings(
      accuracy: LocationAccuracy.bestForNavigation,  // ✅ Máxima precisión
      distanceFilter: 0,  // 🚀 MEJORADO: Dependemos del tiempo y no de la distancia para no perder "estoy quieto"
      intervalDuration: const Duration(seconds: 3),  // 🚀 MEJORADO: Emitir posición cada 3s base
      forceLocationManager: false,  // ✅ Usa Google Play Services (mejor)
      foregroundNotificationConfig: ForegroundNotificationConfig(
        notificationText: "Rastreando ubicación en tiempo real...",
        notificationTitle: "GPS Tracking Activo",
        enableWakeLock: true,  // ✅ Mantiene pantalla encendida
      ),
    ),
  ).listen((Position pos) async {
    try {
      // Token check diferido: la lectura se guardará incondicionalmente en SQLite

      final double speedKmh = pos.speed * 3.6;

      // 🔴 FILTRO 1: Precisión basura (> 50m) → Rechazar
      if (pos.accuracy > 50) {
        print("[GPS] ❌ Precisión muy baja (${pos.accuracy}m). Descartando.");
        return;
      }

      // 🔴 FILTRO 2: Velocidad absurda (> 150 km/h) → Rechazar
      if (speedKmh > 150) {
        print("[GPS] ❌ Velocidad absurda ($speedKmh km/h). Descartando.");
        return;
      }

      // 🔴 FILTRO 3: Salto imposible desde último punto
      if (lastValidPoint != null) {
        double dist = Geolocator.distanceBetween(
          lastValidPoint!.lat,
          lastValidPoint!.lng,
          pos.latitude,
          pos.longitude,
        );
        double timeSecs = (DateTime.now().millisecondsSinceEpoch - lastValidPoint!.timestamp) / 1000.0;

        if (timeSecs > 0) {
          double avgSpeed = (dist / timeSecs) * 3.6;
          if (avgSpeed > 300) {
            print("[GPS] ❌ Salto imposible: ${avgSpeed.toStringAsFixed(0)} km/h. Descartando.");
            return;
          }
        }
      }

      // 🧠 Aplicar Filtro Kalman para suavizar coordenadas
      if (locationFilter == null) {
        locationFilter = LocationKalmanFilter(
          initialLat: pos.latitude,
          initialLng: pos.longitude,
          gpsAccuracy: pos.accuracy,
        );
      }

      final filtered = locationFilter!.update(
        pos.latitude,
        pos.longitude,
        gpsAccuracy: pos.accuracy,
      );

      final state = calculateState(speedKmh);

      // ✅ Adaptive Sampling: Wakelock management
      if (state == "SIN_MOVIMIENTO") {
        stationaryTicks++;
        if (stationaryTicks > 40) { // Aprox 2 minutos
          WakelockPlus.disable();
        }
      } else {
        stationaryTicks = 0;
        WakelockPlus.enable();
      }

      // ✅ NUEVO FILTRO DE FRECUENCIA DE ENVÍO BASADA EN ESTADO
      if (lastValidPoint != null) {
        int timeSinceLastSend = DateTime.now().millisecondsSinceEpoch - lastValidPoint!.timestamp;
        if (state == "SIN_MOVIMIENTO") {
          // Si está quieto, registrar/enviar cada 30 segundos
          if (timeSinceLastSend < 30000) {
            return; // Ignoramos este punto, esperar más tiempo
          }
        } else {
          // Si está en movimiento, registrar/enviar cada 3 segundos
          if (timeSinceLastSend < 3000) {
            return; // Ignoramos este punto, esperar más tiempo
          }
        }
      }

      // Obtener employeeId de la sesión
      final userIdStr = await api.getUserId();
      final employeeId = int.tryParse(userIdStr ?? '');
      // Filtrar puntos inválidos
      if (filtered['lat'] == 0.0 || filtered['lng'] == 0.0 || employeeId == null) {
        print('[GPS] ❌ Punto inválido (lat/lng=0 o employeeId nulo). Descartando.');
        return;
      }
      final point = LocalPoint(
        lat: filtered['lat']!,  // ✅ Usar coordenada filtrada
        lng: filtered['lng']!,  // ✅ Usar coordenada filtrada
        speed: speedKmh,
        accuracy: pos.accuracy,
        state: state,
        timestamp: DateTime.now().millisecondsSinceEpoch,
        employeeId: employeeId,
      );

      // 💾 Guardar en BD local
      await storage.insertPoint(point);
      lastValidPoint = point;

      // 📱 Actualizar notificación
      if (service is AndroidServiceInstance && await service.isForegroundService()) {
        final stats = await storage.getStats();
        service.setForegroundNotificationInfo(
          title: 'Estado: $state | Precisión: ${pos.accuracy.toStringAsFixed(1)}m',
          content: 'Vel: ${speedKmh.toStringAsFixed(1)} km/h | Cola: ${stats['unsynced']}',
        );
      }

      // 🚀 MICRO-BATCHING Y ROBUSTEZ OFF-LINE
      int now = DateTime.now().millisecondsSinceEpoch;
      if (now - lastUploadTime > 15000) { // Procesar lote cada 15 segundos
        final token = await api.getToken();
        if (token != null) {
          final batch = await storage.getUnsyncedPoints(limit: 15);
          if (batch.isNotEmpty) {
            final dataToUpload = batch.map((p) => p.toJson()).toList();
            final ok = await api.uploadBatch(dataToUpload);
            if (ok) {
              final ids = batch.map((p) => p.id!).toList();
              await storage.markPointsAsSynced(ids);
              lastUploadTime = now;
              print("[✅ GPS] Lote realtime enviado: ${ids.length} puntos");
            }
          }
        } else {
          print("[GPS] Sin token. Punto guardado para sincronización futura.");
        }
      }

      // 🧹 Limpiar datos antiguos cada 1 hora
      if (DateTime.now().minute == 0 && DateTime.now().second < 10) {
        await storage.cleanOldSyncedPoints();
      }
    } catch (e) {
      print("[❌ GPS] Error en stream: $e");
    }
  });

  Future<void> flushOfflineQueue() async {
    try {
      final token = await api.getToken();
      if (token == null) return;  // Sin conexión o logout

      final unsyncedPoints = await storage.getUnsyncedPoints(limit: 500); // Límite más agresivo
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
        print("[✅ GPS] Recuperación offline: ${ids.length} puntos sincronizados");

        // BACKPRESSURE: Si trajimos el buffer lleno, es probable que haya más.
        // Llamar recursivamente para drenar rápido.
        if (unsyncedPoints.length == 500) {
          await Future.delayed(const Duration(seconds: 2));
          await flushOfflineQueue();
        }
      }
      // Si falla: reintentar en 5 minutos más
    } catch (e) {
      // Reintentar la próxima vez
    }
  }

  /// Timer de reintento: Intentar enviar puntos no sincronizados cada 5 minutos
  /// Esto permite offset automático cuando se recupera la conexión
  Timer.periodic(const Duration(minutes: 5), (timer) async {
    await flushOfflineQueue();
  });

  service.on('stopService').listen((_) {
    WakelockPlus.disable();
    service.stopSelf();
  });
}
