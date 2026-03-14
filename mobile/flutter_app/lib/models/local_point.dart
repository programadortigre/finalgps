/// Modelo que representa un punto GPS capturado localmente
class LocalPoint {
  final int? id;
  final double lat;
  final double lng;
  final double speed;
  final double accuracy;
  final int timestamp;
  final String state;
  final bool synced;
  final int? employeeId;

  LocalPoint({
    this.id,
    required this.lat,
    required this.lng,
    required this.speed,
    required this.accuracy,
    required this.timestamp,
    this.state = 'SIN_MOVIMIENTO',
    this.synced = false,
    this.employeeId,
  });

  /// Convertir a Map para guardar en SQLite
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'lat': lat,
      'lng': lng,
      'speed': speed,
      'accuracy': accuracy,
      'timestamp': timestamp,
      'state': state,
      'synced': synced ? 1 : 0,
      'employeeId': employeeId,
    };
  }

  /// Crear desde Map (lectura de SQLite).
  /// Nota: SQLite usa snake_case (employee_id), JSON API usa camelCase (employeeId).
  factory LocalPoint.fromMap(Map<String, dynamic> map) {
    return LocalPoint(
      id: map['id'] as int?,
      lat: (map['lat'] as num).toDouble(),
      lng: (map['lng'] as num).toDouble(),
      speed: (map['speed'] as num).toDouble(),
      accuracy: (map['accuracy'] as num).toDouble(),
      timestamp: map['timestamp'] as int,
      state: map['state'] as String? ?? 'SIN_MOVIMIENTO',
      synced: map['synced'] != null ? (map['synced'] as int) == 1 : false,
      // SQLite column es snake_case; camelCase como fallback para compatibilidad
      employeeId: (map['employee_id'] ?? map['employeeId']) as int?,
    );
  }

  /// Convertir a JSON para enviar al servidor
  Map<String, dynamic> toJson() {
    return {
      'lat': lat,
      'lng': lng,
      'speed': speed,
      'accuracy': accuracy,
      'timestamp': timestamp,
      'state': state,
      'employeeId': employeeId,
    };
  }

  @override
  String toString() => 'LocalPoint(id: $id, lat: $lat, lng: $lng, '
      'speed: $speed, accuracy: $accuracy, timestamp: $timestamp, synced: $synced)';
}
