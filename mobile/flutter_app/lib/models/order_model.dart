/// Ítem dentro de un pedido
class OrderItemModel {
  final int? id;
  final int? orderId;
  final int? productId;
  final String titulo;
  final int quantity;
  final double priceUnit;

  double get priceTotal => quantity * priceUnit;

  const OrderItemModel({
    this.id,
    this.orderId,
    this.productId,
    required this.titulo,
    required this.quantity,
    required this.priceUnit,
  });

  factory OrderItemModel.fromMap(Map<String, dynamic> m) => OrderItemModel(
    id: m['id'] as int?,
    orderId: m['order_id'] as int?,
    productId: m['product_id'] as int?,
    titulo: (m['titulo'] ?? '') as String,
    quantity: (m['quantity'] ?? 1) as int,
    priceUnit: ((m['price_unit'] ?? 0) as num).toDouble(),
  );

  Map<String, dynamic> toMap(int localOrderId) => {
    'order_id': localOrderId,
    'product_id': productId,
    'titulo': titulo,
    'quantity': quantity,
    'price_unit': priceUnit,
    'price_total': priceTotal,
  };

  Map<String, dynamic> toApiMap() => {
    'product_id': productId,
    'titulo': titulo,
    'quantity': quantity,
    'price_unit': priceUnit,
  };
}

/// Cabecera de un pedido
class OrderModel {
  final int? id;
  final String clientId;       // UUID generado en el móvil (dedup)
  final int? customerId;
  final String? customerName;
  final int? tripId;
  final String status;
  final double totalSinIgv;
  final double totalConIgv;
  final double descuento;
  final String? notas;
  final bool synced;
  final DateTime createdAt;
  final List<OrderItemModel> items;

  const OrderModel({
    this.id,
    required this.clientId,
    this.customerId,
    this.customerName,
    this.tripId,
    this.status = 'pendiente',
    this.totalSinIgv = 0,
    this.totalConIgv = 0,
    this.descuento = 0,
    this.notas,
    this.synced = false,
    required this.createdAt,
    this.items = const [],
  });

  factory OrderModel.fromMap(Map<String, dynamic> m, {List<OrderItemModel> items = const []}) =>
      OrderModel(
        id: m['id'] as int?,
        clientId: (m['client_id'] ?? '') as String,
        customerId: m['customer_id'] as int?,
        customerName: m['customer_name'] as String?,
        tripId: m['trip_id'] as int?,
        status: (m['status'] ?? 'pendiente') as String,
        totalSinIgv: ((m['total_sin_igv'] ?? 0) as num).toDouble(),
        totalConIgv: ((m['total_con_igv'] ?? 0) as num).toDouble(),
        descuento: ((m['descuento'] ?? 0) as num).toDouble(),
        notas: m['notas'] as String?,
        synced: (m['synced'] ?? 0) == 1,
        createdAt: m['created_at'] is int
            ? DateTime.fromMillisecondsSinceEpoch(m['created_at'] as int)
            : DateTime.tryParse(m['created_at']?.toString() ?? '') ?? DateTime.now(),
        items: items,
      );

  Map<String, dynamic> toApiMap() => {
    'client_id': clientId,
    'customer_id': customerId,
    'trip_id': tripId,
    'items': items.map((i) => i.toApiMap()).toList(),
    'notas': notas,
    'descuento': descuento,
  };

  static const statusLabels = {
    'pendiente': 'Pendiente',
    'en_proceso': 'En Proceso',
    'listo': 'Listo',
    'entregado': 'Entregado',
    'cancelado': 'Cancelado',
  };

  String get statusLabel => statusLabels[status] ?? status;
}
