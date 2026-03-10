import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/local_point.dart';

/// Servicio de almacenamiento local usando SQLite
/// Guarda puntos GPS y controla sincronización
class LocalStorage {
  static Database? _db;
  static const String _tableName = 'gps_points';
  static const String _dbName = 'gps_tracker.db';

  /// Obtener o inicializar la base de datos
  Future<Database> get db async {
    if (_db != null) return _db!;
    _db = await _initDb();
    return _db!;
  }

  /// Inicializar la base de datos
  Future<Database> _initDb() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _dbName);
    return openDatabase(
      path,
      version: 2,
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
    );
  }

  /// Crear tabla en la primera ejecución
  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE $_tableName (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        speed REAL NOT NULL,
        accuracy REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'SIN_MOVIMIENTO',
        synced INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT 0
      )
    ''');

    // Índices para consultas rápidas
    await db.execute('''
      CREATE INDEX idx_timestamp ON $_tableName(timestamp)
    ''');

    await db.execute('''
      CREATE INDEX idx_synced ON $_tableName(synced)
    ''');
  }

  /// Manejar actualizaciones de esquema
  Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      await db.execute('ALTER TABLE $_tableName ADD COLUMN state TEXT NOT NULL DEFAULT "SIN_MOVIMIENTO"');
    }
  }

  /// Insertar un punto GPS
  Future<int> insertPoint(LocalPoint point) async {
    final database = await db;
    return database.insert(
      _tableName,
      {
        'lat': point.lat,
        'lng': point.lng,
        'speed': point.speed,
        'accuracy': point.accuracy,
        'timestamp': point.timestamp,
        'state': point.state,
        'synced': 0,
        'created_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Obtener estadísticas rápidas
  Future<Map<String, int>> getStats() async {
    final database = await db;

    final totalResult = await database.rawQuery(
      'SELECT COUNT(*) as total FROM $_tableName',
    );
    final total = (totalResult.first['total'] as int?) ?? 0;

    final unsyncedResult = await database.rawQuery(
      'SELECT COUNT(*) as unsynced FROM $_tableName WHERE synced = 0',
    );
    final unsynced = (unsyncedResult.first['unsynced'] as int?) ?? 0;

    return {
      'total': total,
      'unsynced': unsynced,
    };
  }

  /// Obtener puntos no sincronizados
  Future<List<LocalPoint>> getUnsyncedPoints({int limit = 100}) async {
    final database = await db;
    final maps = await database.query(
      _tableName,
      where: 'synced = 0',
      orderBy: 'timestamp ASC',
      limit: limit,
    );
    return List.generate(maps.length, (i) => LocalPoint.fromMap(maps[i]));
  }

  /// Marcar puntos como sincronizados
  Future<int> markPointsAsSynced(List<int> ids) async {
    if (ids.isEmpty) return 0;

    final database = await db;
    final placeholders = ids.map((_) => '?').join(',');

    return database.rawUpdate(
      'UPDATE $_tableName SET synced = 1 WHERE id IN ($placeholders)',
      ids,
    );
  }

  /// Limpiar puntos sincronizados más antiguos de 7 días
  Future<int> cleanOldSyncedPoints({int daysToKeep = 7}) async {
    final database = await db;
    final cutoffTime =
        DateTime.now().subtract(Duration(days: daysToKeep)).millisecondsSinceEpoch;

    return database.delete(
      _tableName,
      where: 'synced = 1 AND created_at < ?',
      whereArgs: [cutoffTime],
    );
  }

  /// Obtener todos los puntos de un rango de tiempo (para replay/historial)
  Future<List<LocalPoint>> getPointsByDateRange(
    DateTime from,
    DateTime to,
  ) async {
    final database = await db;
    final fromMs = from.millisecondsSinceEpoch;
    final toMs = to.millisecondsSinceEpoch;

    final maps = await database.query(
      _tableName,
      where: 'timestamp BETWEEN ? AND ?',
      whereArgs: [fromMs, toMs],
      orderBy: 'timestamp ASC',
    );

    return List.generate(maps.length, (i) => LocalPoint.fromMap(maps[i]));
  }

  /// Eliminar todos los datos (usar con cuidado, solo al logout)
  Future<int> deleteAllPoints() async {
    final database = await db;
    return database.delete(_tableName);
  }

  /// Cerrar la base de datos
  Future<void> close() async {
    if (_db != null) {
      await _db!.close();
      _db = null;
    }
  }
}
