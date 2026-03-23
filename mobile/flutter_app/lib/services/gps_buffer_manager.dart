import 'dart:async';
import '../models/local_point.dart';
import 'local_storage.dart';

/// ============================================================================
/// GPSBufferManager - Gestionar buffer de puntos GPS
/// ============================================================================
/// PROBLEMA: Puntos duplicados, desincronización, pérdida de datos
/// SOLUCIÓN: Buffer inteligente con deduplicación y flush periódico
/// ============================================================================

class GPSBufferManager {
  final LocalStorage _storage;
  final List<LocalPoint> _buffer = [];
  Timer? _flushTimer;
  
  static const int _maxBufferSize = 100;
  static const int _flushIntervalSec = 30; // Flush cada 30 segundos

  GPSBufferManager({required LocalStorage storage}) : _storage = storage;

  /// Iniciar gestor de buffer (llamar al arrancar app)
  void start() {
    print('[GPSBuffer] 🚀 Iniciando gestor de buffer');
    _startPeriodicFlush();
  }

  /// Detener gestor (llamar al cerrar app)
  void stop() {
    print('[GPSBuffer] 🛑 Deteniendo gestor de buffer');
    _flushTimer?.cancel();
    _flushTimer = null;
  }

  /// Agregar punto al buffer (con deduplicación)
  Future<void> addPoint(LocalPoint point) async {
    // ✅ FILTRO 1: No agregar duplicados exactos
    if (_buffer.isNotEmpty) {
      final lastPoint = _buffer.last;
      
      // Si el punto es idéntico al anterior (misma lat/lng/timestamp), descartar
      if (lastPoint.lat == point.lat &&
          lastPoint.lng == point.lng &&
          (point.timestamp - lastPoint.timestamp).abs() < 1000) { // Menos de 1 segundo
        print('[GPSBuffer] ⚠️ Punto duplicado descartado');
        return;
      }

      // ✅ FILTRO 2: No agregar puntos muy cercanos en tiempo (< 2 segundos)
      if ((point.timestamp - lastPoint.timestamp).abs() < 2000) {
        print('[GPSBuffer] ⚠️ Punto muy cercano en tiempo, descartado');
        return;
      }
    }

    // Agregar al buffer
    _buffer.add(point);
    print('[GPSBuffer] ✅ Punto agregado (total: ${_buffer.length}/${_maxBufferSize})');

    // ✅ AUTO-FLUSH si buffer está lleno
    if (_buffer.length >= _maxBufferSize) {
      print('[GPSBuffer] 🔥 Buffer lleno! Flushing inmediatamente...');
      await flush();
    }
  }

  /// Limpiar buffer (enviar todos los puntos a storage)
  Future<void> flush() async {
    if (_buffer.isEmpty) {
      print('[GPSBuffer] 📭 Buffer vacío, nada que flush');
      return;
    }

    try {
      print('[GPSBuffer] 💾 Flushing ${_buffer.length} puntos...');
      
      // Guardar en local storage (base de datos local)
      for (final point in _buffer) {
        await _storage.saveLocation(point.toJson());
      }

      print('[GPSBuffer] ✅ Flush exitoso! ${_buffer.length} puntos guardados');
      _buffer.clear();
    } catch (e) {
      print('[GPSBuffer] ❌ Error en flush: $e');
    }
  }

  /// Flush periódico automático cada 30 segundos
  void _startPeriodicFlush() {
    _flushTimer?.cancel();
    
    _flushTimer = Timer.periodic(Duration(seconds: _flushIntervalSec), (timer) async {
      if (_buffer.isNotEmpty) {
        print('[GPSBuffer] ⏱️ Flush periódico...');
        await flush();
      }
    });
  }

  /// Obtener tamaño del buffer
  int get bufferSize => _buffer.length;

  /// Obtener estado del buffer
  Map<String, dynamic> getStatus() {
    return {
      'buffer_size': _buffer.length,
      'buffer_percentage': (_buffer.length / _maxBufferSize * 100).toStringAsFixed(1),
      'is_full': _buffer.length >= _maxBufferSize,
      'last_point': _buffer.isNotEmpty ? _buffer.last.toJson() : null,
    };
  }
}
