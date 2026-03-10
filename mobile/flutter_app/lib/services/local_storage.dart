import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/local_point.dart';

/// Gestor de almacenamiento local SQLite para puntos GPS
/// Permite guardar puntos incluso sin conexión y sincronizar después
class LocalStorage {
  static final LocalStorage _instance = LocalStorage._internal();
  static Database? _database;

  factory LocalStorage() => _instance;
  LocalStorage._internal();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  /// Inicializa la base de datos SQLite
  Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'gps_tracker.db');

    return openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        // Tabla para almacenar puntos GPS localmente
        await db.execute('''
          CREATE TABLE local_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            speed REAL NOT NULL,
            accuracy REAL NOT NULL,
            timestamp INTEGER NOT NULL,
            synced INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        ''');
        
        // Índice para búsquedas rápidas de puntos no sincronizados
        await db.execute('''
          CREATE INDEX idx_synced ON local_points(synced)
        ''');

        // Índice para limpieza de datos antiguos
        await db.execute('''
          CREATE INDEX idx_timestamp ON local_points(timestamp)
        ''');
      },
    );
  }

  /// Guardar un punto GPS local (SIEMPRE se guarda, incluso sin conexión)
  Future<int> insertPoint(LocalPoint point) async {
    final db = await database;
    return db.insert('local_points', point.toMap());
  }

  /// Obtener puntos no sincronizados
  /// 
  /// Parámetro [limit]: Número máximo de puntos a retornar
  /// Retorna: Lista de LocalPoint no sincronizados
  Future<List<LocalPoint>> getUnsyncedPoints({int limit = 100}) async {
    final db = await database;
    final maps = await db.query(
      'local_points',
      where: 'synced = ?',
      whereArgs: [0],
      limit: limit,
      orderBy: 'timestamp ASC', // Enviar en orden cronológico
    );

    return maps
        .map((map) => LocalPoint.fromMap(map))
        .toList();
  }

  /// Contar puntos no sincronizados
  /// Útil para mostrar en notificación: "15 en cola"
  Future<int> getUnsyncedCount() async {
    final db = await database;
    final result = await db.rawQuery(
      'SELECT COUNT(*) as count FROM local_points WHERE synced = 0',
    );
    return (result.first['count'] as int?) ?? 0;
  }

  /// Marcar puntos como sincronizados DESPUÉS de upload exitoso
  /// 
  /// Parámetro [ids]: Lista de IDs a marcar como sincronizados
  Future<void> markPointsAsSynced(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await database;
    await db.update(
      'local_points',
      {'synced': 1},
      where: 'id IN (${ids.map((_) => '?').join(',')})',
      whereArgs: ids,
    );
  }

  /// Limpiar puntos muy antiguos que ya fueron sincronizados
  /// 
  /// Parámetro [daysOld]: Días desde los cuales se eliminan (default 30)
  /// Retorna: Número de puntos eliminados
  Future<int> cleanOldSyncedPoints({int daysOld = 30}) async {
    final db = await database;
    final cutoffTime = DateTime.now()
        .subtract(Duration(days: daysOld))
        .millisecondsSinceEpoch;

    return db.delete(
      'local_points',
      where: 'timestamp < ? AND synced = ?',
      whereArgs: [cutoffTime, 1],
    );
  }

  /// Obtener estadísticas de almacenamiento
  /// Retorna: Map con 'total' y 'unsynced'
  Future<Map<String, int>> getStats() async {
    final db = await database;
    final total = await db.rawQuery(
      'SELECT COUNT(*) as count FROM local_points'
    );
    final unsynced = await db.rawQuery(
      'SELECT COUNT(*) as count FROM local_points WHERE synced = 0',
    );
    return {
      'total': (total.first['count'] as int?) ?? 0,
      'unsynced': (unsynced.first['count'] as int?) ?? 0,
    };
  }

  /// Obtener tamaño estimado de la BD en bytes
  Future<int> getEstimatedSize() async {
    final db = await database;
    final result = await db.rawQuery('''
      SELECT SUM(
        CASE WHEN id IS NOT NULL THEN 80 ELSE 0 END
      ) as size FROM local_points
    ''');
    return (result.first['size'] as int?) ?? 0;
  }
}
