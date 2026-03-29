import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../../models/product_model.dart';
import '../../models/order_model.dart';
import '../../models/app_settings_model.dart';
import '../../services/orders_local_db.dart';
import '../../services/orders_sync_service.dart';
import '../../services/api_service.dart';
import 'product_catalog_screen.dart';

/// Pantalla de creación de pedido en 3 pasos:
///   1. Selección de productos (catálogo)
///   2. Revisión del carrito
///   3. Selección de cliente + confirmación
class CreateOrderScreen extends StatefulWidget {
  final int? tripId;
  final double? currentLat;
  final double? currentLng;

  const CreateOrderScreen({
    super.key,
    this.tripId,
    this.currentLat,
    this.currentLng,
  });

  @override
  State<CreateOrderScreen> createState() => _CreateOrderScreenState();
}

class _CreateOrderScreenState extends State<CreateOrderScreen> {
  final _db = OrdersLocalDb();
  final _api = ApiService();
  late final OrdersSyncService _sync;

  // Carrito
  final Map<int, OrderItemModel> _cart = {}; // product.id → item

  // Cliente
  Map<String, dynamic>? _selectedCustomer;
  final _customerController = TextEditingController();
  List<Map<String, dynamic>> _nearbyCustomers = [];
  List<Map<String, dynamic>> _allCustomers = [];

  // Otros
  final _notasController = TextEditingController();
  double _descuento = 0;
  AppSettings _settings = const AppSettings();
  bool _saving = false;
  bool _loadingCustomers = false;
  int _step = 0; // 0=carrito, 1=cliente+notas, 2=confirmación

  @override
  void initState() {
    super.initState();
    _sync = OrdersSyncService(localDb: _db, api: _api);
    _init();
  }

  Future<void> _init() async {
    _settings = await AppSettings.load();
    if (widget.currentLat != null && widget.currentLng != null) {
      _loadNearbyCustomers();
    }
  }

  Future<void> _loadNearbyCustomers() async {
    setState(() => _loadingCustomers = true);
    final nearby = await _sync.getNearbyCustomers(widget.currentLat!, widget.currentLng!);
    if (mounted) setState(() { _nearbyCustomers = nearby; _loadingCustomers = false; });
  }

  // ── Carrito ─────────────────────────────────────────────────────────────────

  void _addToCart(ProductModel product, int qty) {
    setState(() {
      final key = product.id ?? product.hashCode;
      if (_cart.containsKey(key)) {
        final existing = _cart[key]!;
        _cart[key] = OrderItemModel(
          id: existing.id,
          orderId: existing.orderId,
          productId: existing.productId,
          titulo: existing.titulo,
          quantity: existing.quantity + qty,
          priceUnit: existing.priceUnit,
        );
      } else {
        _cart[key] = OrderItemModel(
          productId: product.id,
          titulo: product.titulo,
          quantity: qty,
          priceUnit: product.precioSegunIgv(_settings.igvEnabled),
        );
      }
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('${product.titulo} × $qty agregado'),
      duration: const Duration(seconds: 1),
      backgroundColor: const Color(0xFF6366F1),
      behavior: SnackBarBehavior.floating,
    ));
  }

  void _removeFromCart(int key) => setState(() => _cart.remove(key));

  void _updateQty(int key, int delta) {
    final item = _cart[key];
    if (item == null) return;
    final newQty = item.quantity + delta;
    if (newQty <= 0) {
      _removeFromCart(key);
    } else {
      setState(() => _cart[key] = OrderItemModel(
        productId: item.productId,
        titulo: item.titulo,
        quantity: newQty,
        priceUnit: item.priceUnit,
      ));
    }
  }

  double get _subtotal => _cart.values.fold(0, (s, i) => s + i.priceTotal);
  double get _totalFinal => (_subtotal - _descuento).clamp(0, double.infinity);
  double get _igvMonto => _settings.igvEnabled ? _subtotal * (_settings.igvPercent / 100) : 0;

  // ── Guardar pedido ──────────────────────────────────────────────────────────

  Future<void> _saveOrder() async {
    if (_cart.isEmpty) return;
    setState(() => _saving = true);

    try {
      final order = OrderModel(
        clientId: const Uuid().v4(),
        customerId: _selectedCustomer?['id'] as int?,
        customerName: _selectedCustomer?['name'] as String? ?? _customerController.text.trim(),
        tripId: widget.tripId,
        totalSinIgv: _settings.igvEnabled ? _subtotal : _subtotal,
        totalConIgv: _settings.igvEnabled ? _subtotal + _igvMonto : _subtotal,
        descuento: _settings.permitirDescuentos ? _descuento : 0,
        notas: _notasController.text.trim().isNotEmpty ? _notasController.text.trim() : null,
        createdAt: DateTime.now(),
        items: _cart.values.toList(),
      );

      await _db.saveOrder(order);

      // Intento de sync inmediata
      _sync.pushPendingOrders();

      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('✅ Pedido guardado · Se sincronizará automáticamente'),
          backgroundColor: Color(0xFF22C55E),
          behavior: SnackBarBehavior.floating,
        ));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Error al guardar: $e'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: Text(_step == 0 ? 'Nuevo Pedido' : _step == 1 ? 'Cliente' : 'Confirmar',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          // Badge del carrito
          if (_cart.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Stack(
                alignment: Alignment.topRight,
                children: [
                  IconButton(
                    icon: const Icon(Icons.shopping_cart_outlined, color: Colors.white),
                    onPressed: () => setState(() => _step = 0),
                  ),
                  Positioned(
                    top: 6, right: 6,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(color: Color(0xFF6366F1), shape: BoxShape.circle),
                      child: Text('${_cart.length}', style: const TextStyle(color: Colors.white, fontSize: 10)),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),

      body: IndexedStack(
        index: _step,
        children: [
          // ── Paso 0: Catálogo ───────────────────────────────────────────────
          ProductCatalogScreen(
            selectionMode: true,
            onAddToCart: _addToCart,
          ),

          // ── Paso 1: Cliente + Notas ────────────────────────────────────────
          _buildClientStep(),

          // ── Paso 2: Resumen ────────────────────────────────────────────────
          _buildSummaryStep(),
        ],
      ),

      bottomNavigationBar: _buildBottomBar(),
    );
  }

  Widget _buildBottomBar() {
    if (_step == 0) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: ElevatedButton.icon(
            icon: const Icon(Icons.arrow_forward),
            label: Text(_cart.isEmpty
                ? 'Selecciona productos'
                : 'Ir al cliente (${_cart.length} productos · S/ ${_subtotal.toStringAsFixed(2)})'),
            style: ElevatedButton.styleFrom(
              backgroundColor: _cart.isEmpty ? Colors.white12 : const Color(0xFF6366F1),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: _cart.isEmpty ? null : () => setState(() => _step = 1),
          ),
        ),
      );
    }

    if (_step == 1) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => setState(() => _step = 0),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white60,
                  side: const BorderSide(color: Colors.white24),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('← Atrás'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: ElevatedButton.icon(
                icon: const Icon(Icons.receipt_long),
                label: const Text('Ver resumen'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF6366F1),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () => setState(() => _step = 2),
              ),
            ),
          ]),
        ),
      );
    }

    // Step 2 — Confirmar
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          Expanded(
            child: OutlinedButton(
              onPressed: () => setState(() => _step = 1),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white60,
                side: const BorderSide(color: Colors.white24),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('← Atrás'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: ElevatedButton.icon(
              icon: _saving
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check_circle_outline),
              label: Text(_saving ? 'Guardando...' : 'Confirmar pedido'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF22C55E),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: _saving ? null : _saveOrder,
            ),
          ),
        ]),
      ),
    );
  }

  // ── Paso 1: Cliente ─────────────────────────────────────────────────────────
  Widget _buildClientStep() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Clientes cercanos (geocerca)
        if (_loadingCustomers)
          const Center(child: Padding(
            padding: EdgeInsets.all(16),
            child: CircularProgressIndicator(color: Color(0xFF6366F1)),
          ))
        else if (_nearbyCustomers.isNotEmpty) ...[
          const Text('📍 Clientes cercanos', style: TextStyle(color: Color(0xFF818CF8), fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ..._nearbyCustomers.map((c) => _CustomerTile(
            customer: c,
            selected: _selectedCustomer?['id'] == c['id'],
            onTap: () => setState(() {
              _selectedCustomer = c;
              _customerController.text = c['name'] ?? '';
            }),
          )),
          const Divider(color: Colors.white12, height: 32),
        ],

        // Cliente manual
        const Text('O escribe el nombre del cliente:', style: TextStyle(color: Colors.white60, fontSize: 13)),
        const SizedBox(height: 8),
        TextField(
          controller: _customerController,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'Nombre del cliente...',
            hintStyle: const TextStyle(color: Colors.white30),
            filled: true, fillColor: Colors.white.withOpacity(0.06),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            prefixIcon: const Icon(Icons.person_outline, color: Colors.white30),
          ),
          onChanged: (_) => setState(() => _selectedCustomer = null),
        ),

        const SizedBox(height: 24),
        const Text('Notas opcionales:', style: TextStyle(color: Colors.white60, fontSize: 13)),
        const SizedBox(height: 8),
        TextField(
          controller: _notasController,
          maxLines: 3,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'Ej: Entregar en almacén, pago contra entrega...',
            hintStyle: const TextStyle(color: Colors.white30),
            filled: true, fillColor: Colors.white.withOpacity(0.06),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
          ),
        ),

        // Descuento (solo si el admin lo habilitó)
        if (_settings.permitirDescuentos) ...[
          const SizedBox(height: 24),
          const Text('Descuento (S/):', style: TextStyle(color: Colors.white60, fontSize: 13)),
          const SizedBox(height: 8),
          TextField(
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: '0.00',
              hintStyle: const TextStyle(color: Colors.white30),
              filled: true, fillColor: Colors.white.withOpacity(0.06),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              prefixText: 'S/ ', prefixStyle: const TextStyle(color: Colors.white60),
            ),
            onChanged: (v) => setState(() => _descuento = double.tryParse(v) ?? 0),
          ),
        ],
      ],
    );
  }

  // ── Paso 2: Resumen ─────────────────────────────────────────────────────────
  Widget _buildSummaryStep() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Cliente seleccionado
        _SummarySection(
          icon: Icons.person_outline,
          title: 'Cliente',
          child: Text(
            _selectedCustomer?['name'] ?? _customerController.text.trim().isNotEmpty
                ? (_selectedCustomer?['name'] ?? _customerController.text.trim())
                : '(Sin cliente)',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
          ),
        ),

        const SizedBox(height: 12),

        // Ítems del carrito
        _SummarySection(
          icon: Icons.inventory_2_outlined,
          title: 'Productos (${_cart.length})',
          child: Column(
            children: _cart.entries.map((e) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(children: [
                Expanded(child: Text(e.value.titulo,
                  style: const TextStyle(color: Colors.white70, fontSize: 13))),
                Text('${e.value.quantity} × S/ ${e.value.priceUnit.toStringAsFixed(2)}',
                  style: const TextStyle(color: Colors.white54, fontSize: 12)),
                const SizedBox(width: 8),
                Text('S/ ${e.value.priceTotal.toStringAsFixed(2)}',
                  style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
              ]),
            )).toList(),
          ),
        ),

        const SizedBox(height: 12),

        // Totales
        _SummarySection(
          icon: Icons.receipt_outlined,
          title: 'Totales',
          child: Column(children: [
            _TotalRow('Subtotal', 'S/ ${_subtotal.toStringAsFixed(2)}'),
            if (_settings.igvEnabled)
              _TotalRow('IGV ${_settings.igvPercent.toInt()}%', 'S/ ${_igvMonto.toStringAsFixed(2)}'),
            if (_descuento > 0 && _settings.permitirDescuentos)
              _TotalRow('Descuento', '- S/ ${_descuento.toStringAsFixed(2)}', isNegative: true),
            const Divider(color: Colors.white12, height: 16),
            _TotalRow('TOTAL', 'S/ ${_totalFinal.toStringAsFixed(2)}', isBold: true),
          ]),
        ),

        if (_notasController.text.isNotEmpty) ...[
          const SizedBox(height: 12),
          _SummarySection(
            icon: Icons.notes_outlined,
            title: 'Notas',
            child: Text(_notasController.text, style: const TextStyle(color: Colors.white70, fontSize: 13)),
          ),
        ],
      ],
    );
  }
}

// ── Widgets auxiliares ────────────────────────────────────────────────────────

class _CustomerTile extends StatelessWidget {
  final Map<String, dynamic> customer;
  final bool selected;
  final VoidCallback onTap;
  const _CustomerTile({required this.customer, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: selected ? const Color(0xFF6366F1).withOpacity(0.2) : Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: selected ? const Color(0xFF6366F1) : Colors.white12),
      ),
      child: Row(children: [
        Icon(Icons.location_on_outlined, size: 16,
          color: selected ? const Color(0xFF818CF8) : Colors.white38),
        const SizedBox(width: 8),
        Expanded(child: Text(customer['name'] ?? '—',
          style: TextStyle(color: selected ? Colors.white : Colors.white70, fontWeight: FontWeight.w600))),
        if (customer['distance'] != null)
          Text('${(customer['distance'] as num).round()} m',
            style: const TextStyle(color: Colors.white38, fontSize: 11)),
      ]),
    ),
  );
}

class _SummarySection extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget child;
  const _SummarySection({required this.icon, required this.title, required this.child});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white.withOpacity(0.04),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: Colors.white10),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Icon(icon, size: 14, color: const Color(0xFF818CF8)),
          const SizedBox(width: 6),
          Text(title, style: const TextStyle(color: Color(0xFF818CF8), fontSize: 12, fontWeight: FontWeight.bold)),
        ]),
        const SizedBox(height: 10),
        child,
      ],
    ),
  );
}

class _TotalRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isNegative;
  final bool isBold;
  const _TotalRow(this.label, this.value, {this.isNegative = false, this.isBold = false});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(children: [
      Text(label, style: TextStyle(
        color: isBold ? Colors.white : Colors.white60,
        fontSize: isBold ? 15 : 13,
        fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
      )),
      const Spacer(),
      Text(value, style: TextStyle(
        color: isNegative ? Colors.redAccent : (isBold ? const Color(0xFF22C55E) : Colors.white),
        fontSize: isBold ? 16 : 13,
        fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
      )),
    ]),
  );
}
