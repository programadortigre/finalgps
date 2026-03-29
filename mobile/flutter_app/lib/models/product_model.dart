/// Modelo de Producto — datos del catálogo local
class ProductModel {
  final int? id;
  final String? externalId;
  final String titulo;
  final double precioConIgv;
  final double precioSinIgv;
  final int stockGeneral;
  final String? categoria;
  final List<String> categorias;
  final String? imagenUrl;
  final String? lastUpdated;

  const ProductModel({
    this.id,
    this.externalId,
    required this.titulo,
    this.precioConIgv = 0,
    this.precioSinIgv = 0,
    this.stockGeneral = 0,
    this.categoria,
    this.categorias = const [],
    this.imagenUrl,
    this.lastUpdated,
  });

  factory ProductModel.fromMap(Map<String, dynamic> m) {
    // categorias viene como JSON string desde SQLite
    List<String> cats = [];
    final raw = m['categorias_json'] ?? m['categorias'];
    if (raw is String && raw.isNotEmpty && raw != 'null') {
      try {
        final decoded = raw.replaceAll('[', '').replaceAll(']', '').replaceAll('"', '');
        cats = decoded.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
      } catch (_) {}
    } else if (raw is List) {
      cats = List<String>.from(raw);
    }
    return ProductModel(
      id: m['id'] as int?,
      externalId: m['external_id'] as String?,
      titulo: (m['titulo'] ?? '') as String,
      precioConIgv: (m['precio_con_igv'] ?? m['precioConIgv'] ?? 0).toDouble(),
      precioSinIgv: (m['precio_sin_igv'] ?? m['precioSinIgv'] ?? 0).toDouble(),
      stockGeneral: (m['stock_general'] ?? m['stockGeneral'] ?? 0) as int,
      categoria: m['categoria'] as String?,
      categorias: cats,
      imagenUrl: m['imagen_url'] as String?,
      lastUpdated: m['last_updated'] as String?,
    );
  }

  Map<String, dynamic> toLocalMap() => {
    'external_id': externalId,
    'titulo': titulo,
    'precio_con_igv': precioConIgv,
    'precio_sin_igv': precioSinIgv,
    'stock_general': stockGeneral,
    'categoria': categoria,
    'categorias_json': categorias.isNotEmpty ? '[${categorias.map((c) => '"$c"').join(',')}]' : '[]',
    'imagen_url': imagenUrl,
    'last_updated': lastUpdated,
  };

  double precioSegunIgv(bool igvEnabled) => igvEnabled ? precioConIgv : precioSinIgv;
}
