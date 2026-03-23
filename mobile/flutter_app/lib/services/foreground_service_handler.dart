import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';

/// ============================================================================
/// ForegroundServiceHandler - Mantener servicio activo en primer plano
/// ============================================================================
/// PROBLEMA: Android mata el servicio si no está en FOREGROUND
/// SOLUCIÓN: Mostrar notificación persistente que evita que Android lo mate
/// ============================================================================

class ForegroundServiceHandler {
  static const String _channelId = 'gps_tracking_channel';
  static const int _notificationId = 888;

  /// Configurar y mantener servicio en foreground
  static Future<void> setupAndMaintainForeground() async {
    final service = FlutterBackgroundService();

    try {
      await service.startService();

      // ✅ FIX: Actualizar notificación cada 10 segundos para mantenerla "viva"
      Future.delayed(Duration.zero, () => _updateNotificationPeriodically());
    } catch (e) {
      print('[ForegroundService] Error iniciando: $e');
    }
  }

  /// Actualizar notificación cada 10 segundos (mantiene servicio activo)
  static void _updateNotificationPeriodically() {
    Future.doWhile(() async {
      try {
        final service = FlutterBackgroundService();
        
        // Verificar si el servicio sigue corriendo
        final isRunning = await service.isRunning();
        if (!isRunning) {
          print('[ForegroundService] ⚠️ Servicio se detuvo. Reiniciando...');
          await setupAndMaintainForeground();
          return true;
        }

        // Actualizar notificación
        if (service is AndroidServiceInstance) {
          await service.setForegroundNotificationInfo(
            title: '📍 GPS Activo',
            content: 'Rastreando ubicación en tiempo real...',
          );
        }

        // Esperar 10 segundos
        await Future.delayed(Duration(seconds: 10));
        return true; // Continuar el loop
      } catch (e) {
        print('[ForegroundService] Error en loop: $e');
        return true; // Continuar incluso con error
      }
    });
  }

  /// Actualizar notificación con info en vivo (velocidad, estado)
  static Future<void> updateNotificationWithLiveData({
    required String title,
    required String content,
  }) async {
    try {
      final service = FlutterBackgroundService();
      if (service is AndroidServiceInstance) {
        await service.setForegroundNotificationInfo(
          title: title,
          content: content,
        );
      }
    } catch (e) {
      print('[ForegroundService] Error actualizando notificación: $e');
    }
  }

  /// Detener servicio limpiamente
  static Future<void> stopService() async {
    try {
      final service = FlutterBackgroundService();
      await service.invoke('stopService');
    } catch (e) {
      print('[ForegroundService] Error deteniendo: $e');
    }
  }
}
