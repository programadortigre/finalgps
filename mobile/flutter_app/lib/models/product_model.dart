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
      cats = raw.map((e) => e?.toString() ?? '').where((e) => e.isNotEmpty).toList();
    }
    // Postgres numeric type can be sent as String, safely parse it
    double parseDouble(dynamic val) {
      if (val == null) return 0.0;
      if (val is num) return val.toDouble();
      if (val is String) return double.tryParse(val) ?? 0.0;
      return 0.0;
    }

    int parseInt(dynamic val) {
      if (val == null) return 0;
      if (val is int) return val;
      if (val is num) return val.toInt();
      if (val is String) return int.tryParse(val) ?? 0;
      return 0;
    }

    return ProductModel(
      id: m['server_id'] != null ? parseInt(m['server_id']) : parseInt(m['id']),
      externalId: m['external_id']?.toString(),
      titulo: (m['titulo'] ?? '') as String,
      precioConIgv: parseDouble(m['precio_con_igv'] ?? m['precioConIgv']),
      precioSinIgv: parseDouble(m['precio_sin_igv'] ?? m['precioSinIgv']),
      stockGeneral: parseInt(m['stock_general'] ?? m['stockGeneral']),
      categoria: m['categoria']?.toString(),
      categorias: cats,
      imagenUrl: m['imagen_url']?.toString(),
      lastUpdated: m['last_updated']?.toString(),
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
