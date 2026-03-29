import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../models/product_model.dart';
import '../../models/app_settings_model.dart';
import '../../services/orders_local_db.dart';

/// Pantalla de catálogo de productos con búsqueda, filtros de categoría
/// y soporte offline (lee desde SQLite local).
class ProductCatalogScreen extends StatefulWidget {
  final void Function(ProductModel product, int quantity)? onAddToCart;
  final bool selectionMode; // true = modo selección para armar pedido

  const ProductCatalogScreen({
    super.key,
    this.onAddToCart,
    this.selectionMode = false,
  });

  @override
  State<ProductCatalogScreen> createState() => _ProductCatalogScreenState();
}

class _ProductCatalogScreenState extends State<ProductCatalogScreen> {
  final _db = OrdersLocalDb();
  final _searchController = TextEditingController();

  List<ProductModel> _products = [];
  List<String> _categories = [];
  String? _selectedCat;
  bool _loading = true;
  AppSettings _settings = const AppSettings();
  String _search = '';

  @override
  void initState() {
    super.initState();
    _init();
    _searchController.addListener(() {
      setState(() { _search = _searchController.text; });
      _loadProducts();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    _settings = await AppSettings.load();
    await _loadCategories();
    await _loadProducts();
  }

  Future<void> _loadCategories() async {
    final cats = await _db.getCategories();
    if (mounted) setState(() => _categories = cats);
  }

  Future<void> _loadProducts() async {
    setState(() => _loading = true);
    final products = await _db.getProducts(
      search: _search.isNotEmpty ? _search : null,
      categoria: _selectedCat,
    );
    if (mounted) setState(() { _products = products; _loading = false; });
  }

  void _selectCategory(String? cat) {
    setState(() => _selectedCat = cat == _selectedCat ? null : cat);
    _loadProducts();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Catálogo', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: TextField(
              controller: _searchController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Buscar producto...',
                hintStyle: TextStyle(color: Colors.white38),
                prefixIcon: const Icon(Icons.search, color: Colors.white38),
                filled: true,
                fillColor: Colors.white.withOpacity(0.08),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          // ── Filtro de categorías ─────────────────────────────────────────────
          if (_categories.isNotEmpty)
            SizedBox(
              height: 44,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                scrollDirection: Axis.horizontal,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemCount: _categories.length,
                itemBuilder: (_, i) {
                  final cat = _categories[i];
                  final selected = cat == _selectedCat;
                  return GestureDetector(
                    onTap: () => _selectCategory(cat),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      decoration: BoxDecoration(
                        color: selected
                            ? const Color(0xFF6366F1)
                            : Colors.white.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(20),
                        border: selected
                            ? null
                            : Border.all(color: Colors.white12),
                      ),
                      child: Text(cat,
                        style: TextStyle(
                          color: selected ? Colors.white : Colors.white60,
                          fontSize: 12,
                          fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),

          // ── Lista de productos ───────────────────────────────────────────────
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
                : _products.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.inventory_2_outlined, color: Colors.white24, size: 48),
                            const SizedBox(height: 12),
                            Text(_search.isNotEmpty ? 'Sin resultados para "$_search"' : 'Catálogo vacío',
                              style: const TextStyle(color: Colors.white38)),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 80),
                        itemCount: _products.length,
                        itemBuilder: (_, i) => _ProductTile(
                          product: _products[i],
                          settings: _settings,
                          selectionMode: widget.selectionMode,
                          onAdd: widget.onAddToCart,
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

// ── Tile de producto ─────────────────────────────────────────────────────────
class _ProductTile extends StatelessWidget {
  final ProductModel product;
  final AppSettings settings;
  final bool selectionMode;
  final void Function(ProductModel, int)? onAdd;

  const _ProductTile({
    required this.product,
    required this.settings,
    this.selectionMode = false,
    this.onAdd,
  });

  void _showAddDialog(BuildContext context) {
    int qty = 1;
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E293B),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => StatefulBuilder(
        builder: (ctx, setS) => Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(product.titulo,
                style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text('S/ ${product.precioSegunIgv(settings.igvEnabled).toStringAsFixed(2)}',
                style: const TextStyle(color: Color(0xFF818CF8), fontSize: 22, fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _QtyBtn(Icons.remove, () { if (qty > 1) setS(() => qty--); }),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text('$qty', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                  ),
                  _QtyBtn(Icons.add, () {
                    if (product.stockGeneral <= 0 || qty < product.stockGeneral) {
                      setS(() => qty++);
                    }
                  }),
                ],
              ),
              const SizedBox(height: 4),
              if (product.stockGeneral > 0)
                Center(child: Text('Stock disponible: ${product.stockGeneral}',
                  style: const TextStyle(color: Colors.white38, fontSize: 12))),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  icon: const Icon(Icons.shopping_cart_outlined, size: 18),
                  label: const Text('Agregar al pedido'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () { Navigator.pop(ctx); onAdd?.call(product, qty); },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final precio = product.precioSegunIgv(settings.igvEnabled);
    final lowStock = product.stockGeneral > 0 && product.stockGeneral <= settings.stockMinimoAlerta;
    final noStock = product.stockGeneral == 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.07)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        leading: _ProductImage(url: product.imagenUrl, show: settings.mostrarImagenesApk),
        title: Text(product.titulo,
          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
          maxLines: 2, overflow: TextOverflow.ellipsis),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (product.categoria != null)
              Text(product.categoria!,
                style: const TextStyle(color: Color(0xFF818CF8), fontSize: 11)),
            Row(children: [
              Text(precio > 0 ? 'S/ ${precio.toStringAsFixed(2)}' : '— sin precio',
                style: TextStyle(
                  color: precio > 0 ? Colors.white70 : Colors.white30,
                  fontSize: 12, fontWeight: FontWeight.bold)),
              const Spacer(),
              if (noStock)
                _badge('Sin stock', Colors.red.shade400)
              else if (lowStock)
                _badge('Queda: ${product.stockGeneral}', Colors.orange.shade400)
              else if (product.stockGeneral > 0)
                _badge('Stock: ${product.stockGeneral}', Colors.green.shade400),
            ]),
          ],
        ),
        trailing: selectionMode && !noStock
            ? IconButton(
                icon: const Icon(Icons.add_circle, color: Color(0xFF6366F1), size: 28),
                onPressed: () => _showAddDialog(context),
              )
            : null,
        onTap: selectionMode && !noStock ? () => _showAddDialog(context) : null,
      ),
    );
  }

  Widget _badge(String text, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(
      color: color.withOpacity(0.15),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: color.withOpacity(0.3)),
    ),
    child: Text(text, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
  );
}

class _QtyBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _QtyBtn(this.icon, this.onTap);

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Container(
      width: 40, height: 40,
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Icon(icon, color: Colors.white70, size: 20),
    ),
  );
}

/// Imagen con caché (`cached_network_image`) o placeholder si no hay URL/imágenes desactivadas.
class _ProductImage extends StatelessWidget {
  final String? url;
  final bool show;
  const _ProductImage({this.url, this.show = true});

  @override
  Widget build(BuildContext context) {
    if (!show || url == null || url!.isEmpty) {
      return Container(
        width: 52, height: 52,
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.06),
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Icon(Icons.inventory_2_outlined, color: Colors.white24, size: 24),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: CachedNetworkImage(
        imageUrl: url!,
        width: 52, height: 52, fit: BoxFit.cover,
        placeholder: (_, __) => Container(
          width: 52, height: 52,
          color: Colors.white.withOpacity(0.06),
          child: const Icon(Icons.image_outlined, color: Colors.white12, size: 24),
        ),
        errorWidget: (_, __, ___) => Container(
          width: 52, height: 52,
          color: Colors.white.withOpacity(0.06),
          child: const Icon(Icons.broken_image_outlined, color: Colors.white12, size: 24),
        ),
      ),
    );
  }
}
