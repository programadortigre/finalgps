import 'package:socket_io_client/socket_io_client.dart' as io;
import 'dart:async';
import 'api_service.dart';

/// ============================================================================
/// SocketReconnectionManager - Manejar desconexiones y reconexiones
/// ============================================================================
/// PROBLEMA: Socket se desconecta y no se reconecta automáticamente
/// SOLUCIÓN: Vigilancia activa + reintentos exponenciales
/// ============================================================================

class SocketReconnectionManager {
  static final SocketReconnectionManager _instance = SocketReconnectionManager._internal();
  
  factory SocketReconnectionManager() => _instance;
  SocketReconnectionManager._internal();

  io.Socket? _socket;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 10;
  static const int _heartbeatIntervalSec = 30;
  static const int _initialBackoffSec = 2;

  /// Conectar socket con manejo de reconexión automática
  Future<void> connect(String token) async {
    try {
      final url = await ApiService.getServerUrl();
      print('[Socket] 🔌 Conectando a $url...');

      _socket = io.io(url,
        io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(5000)
          .setReconnectionAttempts(_maxReconnectAttempts)
          .disableAutoConnect()
          .build(),
      );

      // === EVENTO: Conexión exitosa ===
      _socket!.onConnect((_) {
        print('[Socket] ✅ Conectado!');
        _reconnectAttempts = 0;
        _startHeartbeat();
        _joinRooms(token);
      });

      // === EVENTO: Desconexión ===
      _socket!.onDisconnect((_) {
        print('[Socket] ⚠️ Desconectado');
        _stopHeartbeat();
        _startExponentialBackoff(token);
      });

      // === EVENTO: Error ===
      _socket!.onError((error) {
        print('[Socket] ❌ Error: $error');
        _stopHeartbeat();
        _startExponentialBackoff(token);
      });

      // === EVENTO: Conexión fallida ===
      _socket!.onConnectError((error) {
        print('[Socket] 🔴 Error de conexión: $error');
        _stopHeartbeat();
        _startExponentialBackoff(token);
      });

      // Conectar
      _socket!.connect();

    } catch (e) {
      print('[Socket] Error init: $e');
      rethrow;
    }
  }

  /// Unirse a salas según rol
  void _joinRooms(String token) {
    if (_socket == null || !_socket!.connected) return;

    try {
      _socket!.emit('join_employee', {});
      print('[Socket] ✅ Room: employee joined');
    } catch (e) {
      print('[Socket] Error joining rooms: $e');
    }
  }

  /// Heartbeat cada 30 segundos para detectar desconexiones silenciosas
  void _startHeartbeat() {
    _stopHeartbeat();
    
    _heartbeatTimer = Timer.periodic(Duration(seconds: _heartbeatIntervalSec), (timer) {
      if (_socket?.connected ?? false) {
        _socket!.emit('ping');
        print('[Socket] 💓 Heartbeat enviado');
      } else {
        print('[Socket] ⚠️ Heartbeat: Socket no conectado. Iniciando reconexión...');
        _stopHeartbeat();
        timer.cancel();
      }
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  /// Reconexión exponencial (2s, 4s, 8s, 16s, ...)
  void _startExponentialBackoff(String token) {
    _reconnectTimer?.cancel();

    if (_reconnectAttempts >= _maxReconnectAttempts) {
      print('[Socket] ❌ Max reconexiones alcanzadas. Esperando 5 min...');
      _reconnectTimer = Timer(Duration(minutes: 5), () {
        _reconnectAttempts = 0;
        _startExponentialBackoff(token);
      });
      return;
    }

    _reconnectAttempts++;
    final backoffSec = _initialBackoffSec * (1 << (_reconnectAttempts - 1)); // 2, 4, 8, 16...
    print('[Socket] 🔄 Reconectando en ${backoffSec}s (intento $_reconnectAttempts)...');

    _reconnectTimer = Timer(Duration(seconds: backoffSec), () {
      if (_socket != null && !_socket!.connected) {
        _socket!.connect();
      }
    });
  }

  /// Emitir ubicación (con validación de conexión)
  void emitLocation(Map<String, dynamic> locationData) {
    if (_socket?.connected ?? false) {
      _socket!.emit('location_update', locationData);
      print('[Socket] 📍 Ubicación enviada');
    } else {
      print('[Socket] ⚠️ No conectado. Ubicación en buffer local');
    }
  }

  /// Obtener estado de conexión
  bool get isConnected => _socket?.connected ?? false;

  /// Desconectar limpiamente
  void disconnect() {
    _stopHeartbeat();
    _reconnectTimer?.cancel();
    _socket?.disconnect();
    _socket = null;
  }
}
