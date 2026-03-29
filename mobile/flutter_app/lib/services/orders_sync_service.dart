import 'package:connectivity_plus/connectivity_plus.dart';
import 'api_service.dart';
import 'orders_local_db.dart';
import '../models/product_model.dart';
import '../models/order_model.dart';
import '../models/app_settings_model.dart';

/// Servicio de sincronización bidireccional para el módulo de pedidos.
///
/// Pull: Servidor → SQLite local (productos, settings)
/// Push: SQLite local → Servidor (pedidos pendientes)
///
/// Delta sync: solo descarga productos modificados desde el último sync.
class OrdersSyncService {
  final OrdersLocalDb _localDb;
  final ApiService _api;

  bool _isSyncing = false;

  OrdersSyncService({
    required OrdersLocalDb localDb,
    required ApiService api,
  })  : _localDb = localDb,
        _api = api;

  // ── Verificación de conectividad ─────────────────────────────────────────────

  Future<bool> _hasConnection() async {
    final result = await Connectivity().checkConnectivity();
    return !result.contains(ConnectivityResult.none);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PULL — Servidor → Local
  // ═══════════════════════════════════════════════════════════════════════════

  /// Sincronización completa: productos + settings.
  /// Se llama al abrir la app o al recuperar conexión.
  Future<SyncResult> fullSync() async {
    if (_isSyncing) return SyncResult(skipped: true);
    if (!await _hasConnection()) return SyncResult(offline: true);

    _isSyncing = true;
    int pulled = 0;
    int pushed = 0;

    try {
      // 1. Settings (rápido, siempre primero)
      await pullSettings();

      // 2. Productos (delta: solo los nuevos/modificados)
      pulled = await pullProducts();

      // 3. Push pedidos pendientes
      pushed = await pushPendingOrders();
    } finally {
      _isSyncing = false;
    }

    return SyncResult(productsPulled: pulled, ordersPushed: pushed);
  }

  /// Descarga solo los productos modificados desde el último sync (delta).
  /// Si no hay productos en caché, descarga todo.
  Future<int> pullProducts() async {
    if (!await _hasConnection()) return 0;

    try {
      final lastSync = await _localDb.getLastProductSync();
      final rawProducts = await _api.fetchProducts(since: lastSync);
      if (rawProducts == null || rawProducts.isEmpty) return 0;

      final models = rawProducts.map((m) => ProductModel.fromMap(m)).toList();
      await _localDb.upsertProducts(models);
      print('[OrdersSync] ✅ ${models.length} productos sincronizados');
      return models.length;
    } catch (e) {
      print('[OrdersSync] ❌ Error pulling products: $e');
      return 0;
    }
  }

  /// Descarga y guarda la configuración global del sistema.
  Future<AppSettings?> pullSettings() async {
    if (!await _hasConnection()) {
      return AppSettings.load(); // Devuelve la última cacheada
    }
    try {
      final raw = await _api.fetchSettings();
      if (raw == null) return AppSettings.load();
      final settings = AppSettings.fromMap(raw);
      await settings.save(); // Persiste en SharedPreferences
      return settings;
    } catch (e) {
      print('[OrdersSync] ❌ Error pulling settings: $e');
      return AppSettings.load();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUSH — Local → Servidor
  // ═══════════════════════════════════════════════════════════════════════════

  /// Envía todos los pedidos pendientes al servidor.
  /// Usa el client_id (UUID) para deduplicación en el servidor.
  Future<int> pushPendingOrders() async {
    if (!await _hasConnection()) return 0;

    final pending = await _localDb.getUnsyncedOrders();
    if (pending.isEmpty) return 0;

    int pushed = 0;
    for (final order in pending) {
      try {
        final success = await _api.submitOrder(order.toApiMap());
        if (success) {
          await _localDb.markOrderSynced(order.clientId);
          pushed++;
        }
      } catch (e) {
        print('[OrdersSync] ❌ Error pushing order ${order.clientId}: $e');
      }
    }
    if (pushed > 0) {
      print('[OrdersSync] ✅ $pushed pedidos sincronizados con el servidor');
    }
    return pushed;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LECTURAS LOCALES (sin red)
  // ═══════════════════════════════════════════════════════════════════════════

  Future<List<ProductModel>> getLocalProducts({String? search, String? categoria}) {
    return _localDb.getProducts(search: search, categoria: categoria);
  }

  Future<List<String>> getLocalCategories() => _localDb.getCategories();

  Future<List<OrderModel>> getMyOrders() => _localDb.getMyOrders();

  Future<int> getPendingOrderCount() => _localDb.getUnsyncedOrderCount();

  Future<int> getLocalProductCount() => _localDb.getProductCount();

  /// Geovalla: clientes cercanos con historial si está habilitado.
  Future<List<Map<String, dynamic>>> getNearbyCustomers(double lat, double lng) async {
    if (!await _hasConnection()) return [];
    try {
      return await _api.fetchNearbyCustomers(lat, lng) ?? [];
    } catch (e) {
      return [];
    }
  }
}

/// Resultado de una sincronización
class SyncResult {
  final int productsPulled;
  final int ordersPushed;
  final bool offline;
  final bool skipped;

  const SyncResult({
    this.productsPulled = 0,
    this.ordersPushed = 0,
    this.offline = false,
    this.skipped = false,
  });

  bool get hasActivity => productsPulled > 0 || ordersPushed > 0;

  @override
  String toString() {
    if (offline) return 'Sin conexión — usando caché local';
    if (skipped) return 'Sync en curso, omitido';
    return '↓ $productsPulled productos · ↑ $ordersPushed pedidos';
  }
}
