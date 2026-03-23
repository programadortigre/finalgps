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
      version: 7, // v7: client_id UUID para deduplicación en backend
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
      onOpen: (db) async {
        await db.execute('PRAGMA journal_mode=WAL');
        await db.execute('PRAGMA synchronous=NORMAL');
      },
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE $_tableName (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id     TEXT    UNIQUE,
        lat           REAL    NOT NULL,
        lng           REAL    NOT NULL,
        speed         REAL    NOT NULL,
        accuracy      REAL    NOT NULL,
        state         TEXT    DEFAULT "SIN_MOVIMIENTO",
        source        TEXT,
        timestamp     INTEGER NOT NULL,
        synced        INTEGER DEFAULT 0,
        created_at    INTEGER DEFAULT 0,
        employee_id   INTEGER,
        point_type    TEXT    DEFAULT "normal",
        battery_level INTEGER,
        is_charging   INTEGER
      )
    ''');
    await db.execute('CREATE INDEX idx_timestamp   ON $_tableName(timestamp)');
    await db.execute('CREATE INDEX idx_synced      ON $_tableName(synced)');
    await db.execute('CREATE INDEX idx_employee_id ON $_tableName(employee_id)');
    await db.execute('CREATE UNIQUE INDEX idx_client_id ON $_tableName(client_id)');
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
      try {
        await db.execute(
            'ALTER TABLE $_tableName ADD COLUMN employee_id INTEGER');
      } catch (e) {
        print('[STORAGE] v4 ignore: $e');
      }
    }
    if (oldVersion < 5) {
      print('[STORAGE] Migración v5: Agregando columna source');
      try {
        await db.execute(
            'ALTER TABLE $_tableName ADD COLUMN source TEXT');
      } catch (e) {
        print('[STORAGE] v5 ignore: $e');
      }
    }
    if (oldVersion < 6) {
      print('[STORAGE] Migración v6: Agregando columnas point_type, battery_level, is_charging');
      try { await db.execute('ALTER TABLE $_tableName ADD COLUMN point_type TEXT DEFAULT "normal"'); } catch (_) {}
      try { await db.execute('ALTER TABLE $_tableName ADD COLUMN battery_level INTEGER'); } catch (_) {}
      try { await db.execute('ALTER TABLE $_tableName ADD COLUMN is_charging INTEGER'); } catch (_) {}
    }
    if (oldVersion < 7) {
      print('[STORAGE] Migración v7: Agregando client_id UUID para deduplicación');
      try { await db.execute('ALTER TABLE $_tableName ADD COLUMN client_id TEXT'); } catch (_) {}
      try { await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_client_id ON $_tableName(client_id)'); } catch (_) {}
    }
  }

  // ── Escritura ───────────────────────────────────────────────────────────────

  /// Insertar múltiples puntos GPS en una sola transacción.
  /// Mejora el rendimiento y reduce el uso de CPU/Disco.
  Future<void> insertPoints(List<LocalPoint> points) async {
    if (points.isEmpty) return;
    final database = await db;

    // Check limit before batch insert — límite generoso para soportar días sin conexión
    // A 1 punto/10s en DRIVING = 8640 puntos/día → 10k aguanta ~28h sin conexión
    final countResult = await database.rawQuery('SELECT COUNT(*) as total FROM $_tableName WHERE synced = 0');
    final unsyncedTotal = (countResult.first['total'] as int?) ?? 0;

    if (unsyncedTotal + points.length >= 10000) {
      await _purgeIfNeeded(database);
    }

    await database.transaction((txn) async {
      for (var point in points) {
        await txn.insert(
          _tableName,
          {
            'client_id': point.clientId,
            'lat': point.lat,
            'lng': point.lng,
            'speed': point.speed,
            'accuracy': point.accuracy,
            'state': point.state,
            'source': point.source,
            'timestamp': point.timestamp,
            'synced': 0,
            'created_at': DateTime.now().millisecondsSinceEpoch,
            'employee_id': point.employeeId,
            'point_type': point.pointType ?? 'normal',
            'battery_level': point.batteryLevel,
            'is_charging': point.isCharging != null ? (point.isCharging! ? 1 : 0) : null,
          },
          conflictAlgorithm: ConflictAlgorithm.ignore, // ignore = no sobreescribir si client_id ya existe
        );
      }
    });
  }

  /// Insertar un punto GPS de forma individual.
  Future<int> insertPoint(LocalPoint point) async {
    final database = await db;
    await _checkLimit(database);
    return database.insert(
      _tableName,
      {
        'client_id': point.clientId,
        'lat': point.lat,
        'lng': point.lng,
        'speed': point.speed,
        'accuracy': point.accuracy,
        'state': point.state,
        'source': point.source,
        'timestamp': point.timestamp,
        'synced': 0,
        'created_at': DateTime.now().millisecondsSinceEpoch,
        'employee_id': point.employeeId,
        'point_type': point.pointType ?? 'normal',
        'battery_level': point.batteryLevel,
        'is_charging': point.isCharging != null ? (point.isCharging! ? 1 : 0) : null,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  Future<void> _checkLimit(Database database) async {
    final countResult = await database.rawQuery('SELECT COUNT(*) as total FROM $_tableName WHERE synced = 0');
    final total = (countResult.first['total'] as int?) ?? 0;
    if (total >= 10000) {
      await _purgeIfNeeded(database);
    }
  }

  Future<void> _purgeIfNeeded(Database database) async {
    // PASO 1: eliminar sincronizados más antiguos (nunca toca los pendientes)
    final deletedSynced = await database.rawDelete('''
      DELETE FROM $_tableName
      WHERE id IN (
        SELECT id FROM $_tableName
        WHERE synced = 1
        ORDER BY timestamp ASC
        LIMIT 1000
      )
    ''');

    if (deletedSynced > 0) {
      print('[STORAGE] Purga limpia: $deletedSynced registros ya sincronizados eliminados');
      return;
    }

    // PASO 2: si no había sincronizados, eliminar los NO sincronizados más antiguos
    // Solo como último recurso absoluto (servidor caído por días)
    // Eliminamos los más viejos que ya no tienen valor de posición actual
    final deletedUnsynced = await database.rawDelete('''
      DELETE FROM $_tableName
      WHERE id IN (
        SELECT id FROM $_tableName
        WHERE synced = 0
        ORDER BY timestamp ASC
        LIMIT 500
      )
    ''');
    print('[STORAGE] ⚠️ ÚLTIMO RECURSO: $deletedUnsynced puntos no sincronizados eliminados (servidor caído mucho tiempo)');
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
