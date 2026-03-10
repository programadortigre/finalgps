/// Modelo que representa un punto GPS capturado localmente
class LocalPoint {
  final int? id;
  final double lat;
  final double lng;
  final double speed;
  final double accuracy;
  final int timestamp;
  final bool synced;

  LocalPoint({
    this.id,
    required this.lat,
    required this.lng,
    required this.speed,
    required this.accuracy,
    required this.timestamp,
    this.synced = false,
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
      'synced': synced ? 1 : 0,
    };
  }

  /// Crear desde Map (lectura de SQLite)
  factory LocalPoint.fromMap(Map<String, dynamic> map) {
    return LocalPoint(
      id: map['id'] as int?,
      lat: (map['lat'] as num).toDouble(),
      lng: (map['lng'] as num).toDouble(),
      speed: (map['speed'] as num).toDouble(),
      accuracy: (map['accuracy'] as num).toDouble(),
      timestamp: map['timestamp'] as int,
      synced: (map['synced'] as int) == 1,
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
    };
  }

  @override
  String toString() => 'LocalPoint(id: $id, lat: $lat, lng: $lng, '
      'speed: $speed, accuracy: $accuracy, timestamp: $timestamp, synced: $synced)';
}
