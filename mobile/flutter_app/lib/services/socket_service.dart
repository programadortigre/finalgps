import 'package:socket_io_client/socket_io_client.dart' as io;
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
      
      _socket = io.io(url, io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .disableAutoConnect()
          .build());

      _socket!.onConnect((_) {
        print('[Socket] Conectado a $url');
        _socket!.emit('join_admins');
      });

      _socket!.on('location_update', (data) {
        if (onLocationUpdate != null) {
          onLocationUpdate!(Map<String, dynamic>.from(data as Map));
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
