/// LocalPoint representa un punto GPS guardado localmente en SQLite
/// antes de ser sincronizado con el servidor
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

  /// Convierte el objeto a Map para insertar en SQLite
  Map<String, dynamic> toMap() => {
    'id': id,
    'lat': lat,
    'lng': lng,
    'speed': speed,
    'accuracy': accuracy,
    'timestamp': timestamp,
    'synced': synced ? 1 : 0,
  };

  /// Crea una instancia desde un mapa (para leer de BD)
  factory LocalPoint.fromMap(Map<String, dynamic> map) {
    return LocalPoint(
      id: map['id'] as int?,
      lat: map['lat'] as double,
      lng: map['lng'] as double,
      speed: map['speed'] as double,
      accuracy: map['accuracy'] as double,
      timestamp: map['timestamp'] as int,
      synced: (map['synced'] as int?) == 1,
    );
  }

  /// Para debugging
  @override
  String toString() {
    return 'LocalPoint(lat: $lat, lng: $lng, synced: $synced)';
  }
}
