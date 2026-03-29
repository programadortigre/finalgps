import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/product_model.dart';
import '../models/order_model.dart';

/// Base de datos SQLite local para el módulo de pedidos.
/// 
/// Versión 1 — 3 tablas:
///   products_cache  → catálogo mini para uso offline
///   orders_local    → pedidos pendientes de sincronización
///   order_items_local → ítems de cada pedido
///
/// Estrategia de caché de imágenes: cached_network_image (no se almacenan en SQLite)
class OrdersLocalDb {
  static Database? _db;
  static const _dbName = 'orders_module.db';
  static const _dbVersion = 1;

  Future<Database> get db async {
    if (_db != null) return _db!;
    _db = await _initDb();
    return _db!;
  }

  Future<Database> _initDb() async {
    final path = join(await getDatabasesPath(), _dbName);
    return openDatabase(
      path,
      version: _dbVersion,
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
      onConfigure: (db) async {
        await db.rawQuery('PRAGMA journal_mode=WAL');
        await db.rawQuery('PRAGMA synchronous=NORMAL');
        await db.execute('PRAGMA foreign_keys = ON');
      },
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    // ── Catálogo de productos (caché) ───────────────────────────────────────────
    await db.execute('''
      CREATE TABLE products_cache (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id       INTEGER,
        external_id     TEXT,
        titulo          TEXT    NOT NULL,
        precio_con_igv  REAL    DEFAULT 0,
        precio_sin_igv  REAL    DEFAULT 0,
        stock_general   INTEGER DEFAULT 0,
        categoria       TEXT,
        categorias_json TEXT    DEFAULT '[]',
        imagen_url      TEXT,
        last_updated    TEXT,
        synced_at       INTEGER DEFAULT 0
      )
    ''');
    await db.execute('CREATE UNIQUE INDEX idx_prod_server_id ON products_cache(server_id)');
    await db.execute('CREATE INDEX idx_prod_titulo     ON products_cache(titulo)');
    await db.execute('CREATE INDEX idx_prod_categoria  ON products_cache(categoria)');

    // ── Pedidos locales ──────────────────────────────────────────────────────────
    await db.execute('''
      CREATE TABLE orders_local (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id     TEXT    UNIQUE NOT NULL,
        customer_id   INTEGER,
        customer_name TEXT,
        trip_id       INTEGER,
        status        TEXT    DEFAULT 'pendiente',
        total_sin_igv REAL    DEFAULT 0,
        total_con_igv REAL    DEFAULT 0,
        descuento     REAL    DEFAULT 0,
        notas         TEXT,
        synced        INTEGER DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )
    ''');
    await db.execute('CREATE INDEX idx_order_synced ON orders_local(synced)');
    await db.execute('CREATE INDEX idx_order_created ON orders_local(created_at DESC)');

    // ── Ítems de pedido ──────────────────────────────────────────────────────────
    await db.execute('''
      CREATE TABLE order_items_local (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id    INTEGER NOT NULL REFERENCES orders_local(id) ON DELETE CASCADE,
        product_id  INTEGER,
        titulo      TEXT    NOT NULL,
        quantity    INTEGER NOT NULL,
        price_unit  REAL    NOT NULL,
        price_total REAL    NOT NULL
      )
    ''');
    await db.execute('CREATE INDEX idx_items_order ON order_items_local(order_id)');
  }

  Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    // Futuras migraciones aquí
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCTOS — Cache
  // ═══════════════════════════════════════════════════════════════════════════

  /// Upsert masivo de productos desde el servidor (delta sync).
  /// Usa server_id para detectar existentes y actualizar solo campos de catálogo.
  Future<void> upsertProducts(List<ProductModel> products) async {
    if (products.isEmpty) return;
    final database = await db;
    final now = DateTime.now().millisecondsSinceEpoch;

    await database.transaction((txn) async {
      for (final p in products) {
        final existing = await txn.query(
          'products_cache',
          where: 'server_id = ?',
          whereArgs: [p.id],
        );
        final row = {
          ...p.toLocalMap(),
          'server_id': p.id,
          'synced_at': now,
        };
        if (existing.isEmpty) {
          await txn.insert('products_cache', row,
              conflictAlgorithm: ConflictAlgorithm.ignore);
        } else {
          await txn.update('products_cache', row,
              where: 'server_id = ?', whereArgs: [p.id]);
        }
      }
    });
  }

  /// Obtener todos los productos cacheados con filtros opcionales.
  Future<List<ProductModel>> getProducts({
    String? search,
    String? categoria,
    int limit = 200,
    int offset = 0,
  }) async {
    final database = await db;
    final filters = <String>[];
    final args = <dynamic>[];

    if (search != null && search.isNotEmpty) {
      filters.add('(titulo LIKE ? OR categoria LIKE ? OR categorias_json LIKE ?)');
      final q = '%$search%';
      args.addAll([q, q, q]);
    }
    if (categoria != null && categoria.isNotEmpty) {
      filters.add('(categoria = ? OR categorias_json LIKE ?)');
      args.addAll([categoria, '%"$categoria"%']);
    }

    final where = filters.isNotEmpty ? filters.join(' AND ') : null;
    final rows = await database.query(
      'products_cache',
      where: where,
      whereArgs: args.isNotEmpty ? args : null,
      orderBy: 'titulo ASC',
      limit: limit,
      offset: offset,
    );
    return rows.map(ProductModel.fromMap).toList();
  }

  /// Categorías únicas cacheadas localmente.
  Future<List<String>> getCategories() async {
    final database = await db;
    final rows = await database.rawQuery(
      'SELECT DISTINCT categoria FROM products_cache WHERE categoria IS NOT NULL ORDER BY categoria ASC'
    );
    return rows.map((r) => r['categoria'] as String).toList();
  }

  /// Timestamp del último sync (para delta update: ?since=X)
  Future<String?> getLastProductSync() async {
    final database = await db;
    final rows = await database.rawQuery(
      'SELECT MAX(last_updated) as lu FROM products_cache'
    );
    return rows.first['lu'] as String?;
  }

  Future<int> getProductCount() async {
    final database = await db;
    final rows = await database.rawQuery('SELECT COUNT(*) as c FROM products_cache');
    return (rows.first['c'] as int?) ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PEDIDOS — Escritura offline
  // ═══════════════════════════════════════════════════════════════════════════

  /// Guarda un pedido completo con sus ítems en una sola transacción.
  Future<int> saveOrder(OrderModel order) async {
    final database = await db;
    final now = DateTime.now().millisecondsSinceEpoch;

    return database.transaction((txn) async {
      final orderId = await txn.insert('orders_local', {
        'client_id': order.clientId,
        'customer_id': order.customerId,
        'customer_name': order.customerName,
        'trip_id': order.tripId,
        'status': order.status,
        'total_sin_igv': order.totalSinIgv,
        'total_con_igv': order.totalConIgv,
        'descuento': order.descuento,
        'notas': order.notas,
        'synced': 0,
        'created_at': now,
        'updated_at': now,
      }, conflictAlgorithm: ConflictAlgorithm.ignore);

      for (final item in order.items) {
        await txn.insert('order_items_local', item.toMap(orderId));
      }
      return orderId;
    });
  }

  /// Pedidos no sincronizados (para el push al servidor).
  Future<List<OrderModel>> getUnsyncedOrders() async {
    final database = await db;
    final rows = await database.query(
      'orders_local',
      where: 'synced = 0',
      orderBy: 'created_at ASC',
    );
    final orders = <OrderModel>[];
    for (final row in rows) {
      final items = await _getItemsForOrder(database, row['id'] as int);
      orders.add(OrderModel.fromMap(row, items: items));
    }
    return orders;
  }

  /// Pedidos del vendedor — últimos 3 meses.
  Future<List<OrderModel>> getMyOrders({int daysBack = 90}) async {
    final database = await db;
    final cutoff = DateTime.now().subtract(Duration(days: daysBack)).millisecondsSinceEpoch;
    final rows = await database.query(
      'orders_local',
      where: 'created_at >= ?',
      whereArgs: [cutoff],
      orderBy: 'created_at DESC',
    );
    final orders = <OrderModel>[];
    for (final row in rows) {
      final items = await _getItemsForOrder(database, row['id'] as int);
      orders.add(OrderModel.fromMap(row, items: items));
    }
    return orders;
  }

  Future<List<OrderItemModel>> _getItemsForOrder(Database database, int orderId) async {
    final rows = await database.query(
      'order_items_local',
      where: 'order_id = ?',
      whereArgs: [orderId],
    );
    return rows.map(OrderItemModel.fromMap).toList();
  }

  /// Marcar pedido como sincronizado.
  Future<void> markOrderSynced(String clientId) async {
    final database = await db;
    await database.update(
      'orders_local',
      {'synced': 1, 'updated_at': DateTime.now().millisecondsSinceEpoch},
      where: 'client_id = ?',
      whereArgs: [clientId],
    );
  }

  Future<int> getUnsyncedOrderCount() async {
    final database = await db;
    final rows = await database.rawQuery(
      'SELECT COUNT(*) as c FROM orders_local WHERE synced = 0'
    );
    return (rows.first['c'] as int?) ?? 0;
  }

  Future<void> close() async {
    if (_db != null) {
      await _db!.close();
      _db = null;
    }
  }
}
