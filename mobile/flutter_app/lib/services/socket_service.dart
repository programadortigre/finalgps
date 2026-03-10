import 'package:socket_io_client/socket_io_client.dart' as io;
import 'api_service.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  io.Socket? _socket;
  Function(Map<String, dynamic>)? onLocationUpdate;

  Future<void> connect() async {
    if (_socket != null && _socket!.connected) return;

    final url = await ApiService.getServerUrl();
    final token = await ApiService().getToken();

    _socket = io.io(url, io.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'token': token})
      .disableAutoConnect()
      .build());

    _socket!.onConnect((_) {
      print('[Socket] Connected to $url');
      _socket!.emit('join_admins');
    });

    _socket!.on('location_update', (data) {
      if (onLocationUpdate != null) {
        onLocationUpdate!(data as Map<String, dynamic>);
      }
    });

    _socket!.onDisconnect((_) => print('[Socket] Disconnected'));
    _socket!.onConnectError((err) => print('[Socket] Connection Error: $err'));

    _socket!.connect();
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }

  bool get isConnected => _socket?.connected ?? false;
}
