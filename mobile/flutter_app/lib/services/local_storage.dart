import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/local_point.dart';

/// Servicio de almacenamiento local usando SQLite
/// Guarda puntos GPS y controla sincronización con el servidor
class LocalStorage {
  static Database? _db;
  static const String _tableName = 'gps_points';
  static const String _dbName = 'gps_tracker.db';

  // ── Inicialización ──────────────────────────────────────────────────────────

  Future<Database> get db async {
    if (_db != null) return _db!;
    _db = await _initDb();
    return _db!;
  }

  Future<Database> _initDb() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _dbName);
    return openDatabase(
      path,
      version: 4,
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE $_tableName (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        lat          REAL    NOT NULL,
        lng          REAL    NOT NULL,
        speed        REAL    NOT NULL,
        accuracy     REAL    NOT NULL,
        state        TEXT    DEFAULT "SIN_MOVIMIENTO",
        timestamp    INTEGER NOT NULL,
        synced       INTEGER DEFAULT 0,
        created_at   INTEGER DEFAULT 0,
        employee_id  INTEGER
      )
    ''');
    await db.execute('CREATE INDEX idx_timestamp   ON $_tableName(timestamp)');
    await db.execute('CREATE INDEX idx_synced      ON $_tableName(synced)');
    await db.execute('CREATE INDEX idx_employee_id ON $_tableName(employee_id)');
  }

  Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    print('[STORAGE] Upgrade DB de v$oldVersion a v$newVersion');
    if (oldVersion < 2) {
      print('[STORAGE] Migración v2: Agregando columna state');
      await db.execute(
          'ALTER TABLE $_tableName ADD COLUMN state TEXT DEFAULT "SIN_MOVIMIENTO"');
    }
    if (oldVersion < 4) {
      print('[STORAGE] Migración v4: Agregando columna employee_id');
      // Agregar columna employee_id a instalaciones existentes
      try {
        await db.execute(
            'ALTER TABLE $_tableName ADD COLUMN employee_id INTEGER');
      } catch (e) {
        print('[STORAGE] v4 ignore: $e');
      }
    }
  }

  // ── Escritura ───────────────────────────────────────────────────────────────

  /// Insertar un punto GPS.
  /// FIX A4: la purga elimina primero registros ya sincronizados.
  /// Solo si sigue sin espacio suficiente, elimina los más antiguos sin sincronizar
  /// como último recurso (y lo advierte con un log).
  Future<int> insertPoint(LocalPoint point) async {
    final database = await db;

    // Contar total de registros
    final countResult = await database
        .rawQuery('SELECT COUNT(*) as total FROM $_tableName');
    final total = (countResult.first['total'] as int?) ?? 0;

    if (total >= 5000) {
      // ── PASO 1: eliminar los 500 sincronizados más antiguos ────────────────
      final deletedSynced = await database.rawDelete('''
        DELETE FROM $_tableName
        WHERE id IN (
          SELECT id FROM $_tableName
          WHERE synced = 1
          ORDER BY timestamp ASC
          LIMIT 500
        )
      ''');

      if (deletedSynced == 0) {
        // ── PASO 2: si no había sincronizados, ÚLTIMO RECURSO ─────────────────
        // Advertimos explícitamente porque estamos descartando datos no enviados.
        final deletedUnsynced = await database.rawDelete('''
          DELETE FROM $_tableName
          WHERE id IN (
            SELECT id FROM $_tableName
            ORDER BY timestamp ASC
            LIMIT 200
          )
        ''');
        // ignore: avoid_print
        print('[STORAGE] ⚠️ ÚLTIMO RECURSO: eliminados $deletedUnsynced puntos '
            'NO sincronizados (buffer lleno y sin conectividad prolongada)');
      } else {
        // ignore: avoid_print
        print('[STORAGE] Purga: $deletedSynced registros sincronizados eliminados');
      }
    }

    return database.insert(
      _tableName,
      {
        'lat': point.lat,
        'lng': point.lng,
        'speed': point.speed,
        'accuracy': point.accuracy,
        'state': point.state,
        'timestamp': point.timestamp,
        'synced': 0,
        'created_at': DateTime.now().millisecondsSinceEpoch,
        'employee_id': point.employeeId,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // ── Lectura ─────────────────────────────────────────────────────────────────

  /// Obtener estadísticas rápidas
  Future<Map<String, int>> getStats() async {
    final database = await db;
    final totalResult =
        await database.rawQuery('SELECT COUNT(*) as total FROM $_tableName');
    final total = (totalResult.first['total'] as int?) ?? 0;

    final unsyncedResult = await database
        .rawQuery('SELECT COUNT(*) as un FROM $_tableName WHERE synced = 0');
    final unsynced = (unsyncedResult.first['un'] as int?) ?? 0;

    return {'total': total, 'unsynced': unsynced};
  }

  Future<int> getUnsyncedCount() async {
    final database = await db;
    final result = await database.rawQuery('SELECT COUNT(*) as un FROM $_tableName WHERE synced = 0');
    return (result.first['un'] as int?) ?? 0;
  }

  /// Obtener puntos no sincronizados ordenados por timestamp
  Future<List<LocalPoint>> getUnsyncedPoints({int limit = 100}) async {
    final database = await db;
    final maps = await database.query(
      _tableName,
      where: 'synced = 0',
      orderBy: 'timestamp ASC',
      limit: limit,
    );
    return maps.map((m) => LocalPoint.fromMap(m)).toList();
  }

  // FIX C1: obtener el último punto válido para restaurar estado tras reinicio del OS
  Future<LocalPoint?> getLastValidPoint() async {
    try {
      final database = await db;
      final maps = await database.query(
        _tableName,
        orderBy: 'timestamp DESC',
        limit: 1,
      );
      if (maps.isEmpty) return null;
      return LocalPoint.fromMap(maps.first);
    } catch (e) {
      // ignore: avoid_print
      print('[STORAGE] Error obteniendo último punto: $e');
      return null;
    }
  }

  /// Marcar puntos como sincronizados (operación atómica)
  Future<int> markPointsAsSynced(List<int> ids) async {
    if (ids.isEmpty) return 0;
    final database = await db;
    final placeholders = ids.map((_) => '?').join(',');
    return database.rawUpdate(
      'UPDATE $_tableName SET synced = 1 WHERE id IN ($placeholders)',
      ids,
    );
  }

  /// Limpiar puntos sincronizados más antiguos de N días.
  /// FIX: ahora se llama periódicamente desde el watchdog.
  Future<int> cleanOldSyncedPoints({int daysToKeep = 7}) async {
    final database = await db;
    final cutoffTime =
        DateTime.now().subtract(Duration(days: daysToKeep)).millisecondsSinceEpoch;
    final deleted = await database.delete(
      _tableName,
      where: 'synced = 1 AND created_at < ?',
      whereArgs: [cutoffTime],
    );
    if (deleted > 0) {
      // ignore: avoid_print
      print('[STORAGE] Limpieza periódica: $deleted registros sincronizados eliminados');
    }
    return deleted;
  }

  /// Obtener todos los puntos de un rango de tiempo (replay/historial)
  Future<List<LocalPoint>> getPointsByDateRange(DateTime from, DateTime to) async {
    final database = await db;
    final maps = await database.query(
      _tableName,
      where: 'timestamp BETWEEN ? AND ?',
      whereArgs: [from.millisecondsSinceEpoch, to.millisecondsSinceEpoch],
      orderBy: 'timestamp ASC',
    );
    return maps.map((m) => LocalPoint.fromMap(m)).toList();
  }

  /// Eliminar todos los datos (solo al logout)
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
