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
  final String? source; // ✅ gps, network, fused, heartbeat
  final String? pointType; // ✅ normal, recovery, manual, gps_off
  final int? batteryLevel; // ✅ 0-100
  final bool? isCharging; // ✅ true/false

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
    this.source,
    this.pointType = 'normal',
    this.batteryLevel,
    this.isCharging,
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
      'employee_id': employeeId,
      'source': source,
      'point_type': pointType,
      'battery_level': batteryLevel,
      'is_charging': isCharging != null ? (isCharging! ? 1 : 0) : null,
    };
  }

  /// Crear desde Map (lectura de SQLite).
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
      employeeId: (map['employee_id'] ?? map['employeeId']) as int?,
      source: map['source'] as String?,
      pointType: map['point_type'] as String? ?? 'normal',
      batteryLevel: map['battery_level'] as int?,
      isCharging: map['is_charging'] != null ? (map['is_charging'] as int) == 1 : null,
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
      'source': source,
      'point_type': pointType,
      'battery': batteryLevel,
      'is_charging': isCharging,
    };
  }

  @override
  String toString() => 'LocalPoint(id: $id, lat: $lat, lng: $lng, source: $source, '
      'speed: $speed, accuracy: $accuracy, timestamp: $timestamp, battery: $batteryLevel, charging: $isCharging)';
}
