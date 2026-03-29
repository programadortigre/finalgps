import 'package:flutter/material.dart';
import '../../models/order_model.dart';
import '../../models/app_settings_model.dart';
import '../../services/orders_local_db.dart';
import '../../services/orders_sync_service.dart';
import '../../services/api_service.dart';
import 'create_order_screen.dart';

/// Lista de pedidos del vendedor — últimos 3 meses (SQLite local).
/// Se sincroniza en segundo plano al abrir la pantalla.
class OrdersListScreen extends StatefulWidget {
  const OrdersListScreen({super.key});

  @override
  State<OrdersListScreen> createState() => _OrdersListScreenState();
}

class _OrdersListScreenState extends State<OrdersListScreen> {
  final _db = OrdersLocalDb();
  final _api = ApiService();
  late final OrdersSyncService _sync;

  List<OrderModel> _orders = [];
  bool _loading = true;
  bool _syncing = false;
  int _pendingCount = 0;
  AppSettings _settings = const AppSettings();

  @override
  void initState() {
    super.initState();
    _sync = OrdersSyncService(localDb: _db, api: _api);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    _settings = await AppSettings.load();
    final orders = await _db.getMyOrders();
    final pending = await _db.getUnsyncedOrderCount();
    if (mounted) {
      setState(() { _orders = orders; _pendingCount = pending; _loading = false; });
    }

    // Sync en background
    _syncInBackground();
  }

  Future<void> _syncInBackground() async {
    setState(() => _syncing = true);
    await _sync.pushPendingOrders();
    final pending = await _db.getUnsyncedOrderCount();
    if (mounted) setState(() { _pendingCount = pending; _syncing = false; });
  }

  Color _statusColor(String status) => switch (status) {
    'pendiente'  => const Color(0xFFF59E0B),
    'en_proceso' => const Color(0xFF3B82F6),
    'listo'      => const Color(0xFF8B5CF6),
    'entregado'  => const Color(0xFF22C55E),
    'cancelado'  => const Color(0xFFEF4444),
    _            => Colors.white38,
  };

  IconData _statusIcon(String status) => switch (status) {
    'pendiente'  => Icons.hourglass_top_rounded,
    'en_proceso' => Icons.sync_rounded,
    'listo'      => Icons.inventory_2_outlined,
    'entregado'  => Icons.check_circle_outline,
    'cancelado'  => Icons.cancel_outlined,
    _            => Icons.help_outline,
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Mis Pedidos', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          if (_syncing)
            const Padding(
              padding: EdgeInsets.only(right: 16),
              child: Center(child: SizedBox(width: 18, height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white54))),
            )
          else
            IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white70),
              onPressed: _load,
            ),
        ],
      ),

      body: Column(
        children: [
          // Banner: pedidos pendientes de sync
          if (_pendingCount > 0)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              color: const Color(0xFF6366F1).withOpacity(0.15),
              child: Row(children: [
                const Icon(Icons.cloud_upload_outlined, color: Color(0xFF818CF8), size: 16),
                const SizedBox(width: 8),
                Expanded(child: Text(
                  '$_pendingCount ${_pendingCount == 1 ? 'pedido pendiente' : 'pedidos pendientes'} de sincronización',
                  style: const TextStyle(color: Color(0xFF818CF8), fontSize: 12),
                )),
                if (_syncing)
                  const SizedBox(width: 14, height: 14,
                    child: CircularProgressIndicator(strokeWidth: 1.5, color: Color(0xFF818CF8))),
              ]),
            ),

          // Lista
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
                : _orders.isEmpty
                    ? Center(
                        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                          const Icon(Icons.receipt_long_outlined, color: Colors.white12, size: 56),
                          const SizedBox(height: 12),
                          const Text('Sin pedidos aún', style: TextStyle(color: Colors.white38)),
                          const SizedBox(height: 4),
                          const Text('Toca el botón + para crear tu primer pedido',
                            style: TextStyle(color: Colors.white24, fontSize: 12)),
                        ]),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 80),
                        itemCount: _orders.length,
                        itemBuilder: (_, i) => _OrderCard(
                          order: _orders[i],
                          statusColor: _statusColor(_orders[i].status),
                          statusIcon: _statusIcon(_orders[i].status),
                        ),
                      ),
          ),
        ],
      ),

      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await Navigator.push<bool>(
            context, MaterialPageRoute(builder: (_) => const CreateOrderScreen()));
          if (created == true) _load();
        },
        backgroundColor: const Color(0xFF6366F1),
        label: const Text('Nuevo pedido', style: TextStyle(color: Colors.white)),
        icon: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
}

// ── Tarjeta de pedido ────────────────────────────────────────────────────────
class _OrderCard extends StatelessWidget {
  final OrderModel order;
  final Color statusColor;
  final IconData statusIcon;

  const _OrderCard({required this.order, required this.statusColor, required this.statusIcon});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.04),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.07)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 42, height: 42,
          decoration: BoxDecoration(
            color: statusColor.withOpacity(0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(statusIcon, color: statusColor, size: 22),
        ),
        title: Row(children: [
          Expanded(child: Text(
            order.customerName?.isNotEmpty == true ? order.customerName! : 'Sin cliente',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
          )),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.15),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: statusColor.withOpacity(0.3)),
            ),
            child: Text(order.statusLabel,
              style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold)),
          ),
        ]),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Row(children: [
              Text('S/ ${order.totalConIgv.toStringAsFixed(2)}',
                style: const TextStyle(color: Color(0xFF22C55E), fontWeight: FontWeight.bold, fontSize: 15)),
              const Spacer(),
              Text('${order.items.length} ${order.items.length == 1 ? 'ítem' : 'ítems'}',
                style: const TextStyle(color: Colors.white38, fontSize: 12)),
            ]),
            Text(
              _formatDate(order.createdAt),
              style: const TextStyle(color: Colors.white24, fontSize: 11),
            ),
            if (!order.synced)
              const Text('⏳ Pendiente de sync', style: TextStyle(color: Color(0xFFF59E0B), fontSize: 11)),
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 60) return 'Hace ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'Hace ${diff.inHours}h';
    return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
  }
}
