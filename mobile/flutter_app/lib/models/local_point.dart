import 'package:uuid/uuid.dart';

const _uuid = Uuid();

/// Modelo que representa un punto GPS capturado localmente
class LocalPoint {
  final int? id;
  final String clientId; // UUID único por punto — previene duplicados en backend
  final double lat;
  final double lng;
  final double speed;
  final double accuracy;
  final int timestamp;
  final String state;
  final bool synced;
  final int? employeeId;
  final String? source;
  final String? pointType;
  final int? batteryLevel;
  final bool? isCharging;

  LocalPoint({
    this.id,
    String? clientId,
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
  }) : clientId = clientId ?? _uuid.v4();

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'client_id': clientId,
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

  factory LocalPoint.fromMap(Map<String, dynamic> map) {
    return LocalPoint(
      id: map['id'] as int?,
      clientId: map['client_id'] as String?,
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

  Map<String, dynamic> toJson() {
    return {
      'client_id': clientId,
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
  String toString() => 'LocalPoint(clientId: $clientId, lat: $lat, lng: $lng, '
      'speed: $speed, accuracy: $accuracy, timestamp: $timestamp)';
}
