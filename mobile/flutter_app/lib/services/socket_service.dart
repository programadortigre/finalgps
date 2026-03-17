import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:flutter_background_service/flutter_background_service.dart' as io_bg;
import 'api_service.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  static Function(Map<String, dynamic>)? onLocationUpdate;
  
  factory SocketService() => _instance;
  SocketService._internal();

  static io.Socket? _socket;

  /// Inicializar socket con token
  static Future<void> init(String token) async {
    if (_socket != null && _socket!.connected) return;

    try {
      final url = await ApiService.getServerUrl();
      final userId = await ApiService().getUserId();
      final userRole = await ApiService().getUserRole();
      
      _socket = io.io(url, io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .disableAutoConnect()
          .build());

      _socket!.onConnect((_) {
        print('[Socket] Conectado a $url');
        
        // Unirse a salas según el rol
        if (userRole?.toLowerCase() == 'admin') {
          _socket!.emit('join_admins');
        }
        
        if (userId != null) {
          _socket!.emit('join_employee', userId);
          print('[Socket] Unido a sala user:$userId');
        }
      });

      _socket!.on('location_update', (data) {
        if (onLocationUpdate != null) {
          onLocationUpdate!(Map<String, dynamic>.from(data as Map));
        }
      });

      // ✅ NUEVO: Escuchar comando de rastreo remoto (Admin -> Server -> App)
      _socket!.on('remote_tracking_toggle', (data) async {
        final service = io_bg.FlutterBackgroundService();
        final bool enabled = data['enabled'] ?? false;
        print('[Socket] Remote Tracking Toggle: $enabled');

        if (enabled) {
          final isRunning = await service.isRunning();
          if (!isRunning) {
            print('[Socket] Arrancando rastreo remotamente...');
            await service.startService();
          }
        } else {
          print('[Socket] Deteniendo rastreo remotamente...');
          service.invoke('stopService');
        }
      });

      _socket!.onDisconnect((_) => print('[Socket] Desconectado'));
      _socket!.onConnectError((err) => print('[Socket] Error de conexión: $err'));

      _socket!.connect();
    } catch (e) {
      print('[Socket] Error al inicializar: $e');
    }
  }

  static void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }

  static bool get isConnected => _socket?.connected ?? false;

  // Mantener interfaz antigua para compatibilidad
  Future<void> connect() async => await init(await ApiService().getToken() ?? '');
}
