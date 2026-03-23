import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../services/api_service.dart';

class RouteScreen extends StatefulWidget {
  const RouteScreen({super.key});

  @override
  State<RouteScreen> createState() => _RouteScreenState();
}

class _RouteScreenState extends State<RouteScreen> {
  final _api = ApiService();
  final MapController _mapCtrl = MapController();
  
  Map<String, dynamic>? _routeData;
  List<dynamic> _customers = [];
  Map<String, dynamic>? _activeVisit;
  bool _isLoading = true;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _fetchData();
    // Polling ligero para actualizar estados de visitas automáticamente cada 30s
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) => _fetchData(quiet: true));
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchData({bool quiet = false}) async {
    if (!quiet) setState(() => _isLoading = true);
    try {
      final route = await _api.fetchMyRoute();
      final active = await _api.fetchActiveVisit();
      
      if (mounted) {
        setState(() {
          _routeData = route;
          _customers = route?['customers'] ?? [];
          _activeVisit = active;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Color _getStatusColor(String? status) {
    switch (status) {
      case 'completed': return Colors.greenAccent;
      case 'ongoing': return Colors.yellowAccent;
      case 'auto_closed': return Colors.orangeAccent;
      default: return Colors.white54;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      appBar: AppBar(
        title: const Text('Ruta del Día', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => _fetchData(),
          )
        ],
      ),
      body: _isLoading 
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6C63FF)))
          : Column(
              children: [
                // ── Area de Mapa ──
                Expanded(
                  flex: 2,
                  child: ClipRRect(
                    borderRadius: const BorderRadius.vertical(bottom: Radius.circular(30)),
                    child: FlutterMap(
                      mapController: _mapCtrl,
                      options: MapOptions(
                        initialCenter: _customers.isNotEmpty 
                            ? LatLng(_customers[0]['lat'], _customers[0]['lng'])
                            : const LatLng(-12.0464, -77.0428),
                        initialZoom: 14,
                      ),
                      children: [
                        TileLayer(
                          urlTemplate: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
                          subdomains: const ['a', 'b', 'c', 'd'],
                        ),
                        // Marcadores de Clientes
                        MarkerLayer(
                          markers: _customers.map((c) {
                            final isTarget = _activeVisit?['customer_id'] == c['id'];
                            final status = c['visit_status'];
                            return Marker(
                              point: LatLng(c['lat'], c['lng']),
                              width: 40, height: 40,
                              child: Icon(
                                isTarget ? Icons.location_on : Icons.location_on_outlined,
                                color: isTarget ? Colors.yellow : _getStatusColor(status),
                                size: isTarget ? 35 : 25,
                              ),
                            );
                          }).toList(),
                        ),
                      ],
                    ),
                  ),
                ),
                
                // ── Lista de Clientes ──
                Expanded(
                  flex: 3,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Puntos de Visita', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 10),
                        if (_activeVisit != null) 
                          _buildActiveVisitBanner(),
                        const SizedBox(height: 10),
                        Expanded(
                          child: ListView.builder(
                            itemCount: _customers.length,
                            itemBuilder: (ctx, idx) => _buildCustomerCard(_customers[idx], idx + 1),
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              ],
            ),
    );
  }

  Widget _buildActiveVisitBanner() {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.yellow.withOpacity(0.15),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: Colors.yellow.withOpacity(0.5)),
      ),
      child: Row(
        children: [
          const Icon(Icons.timer, color: Colors.yellow),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('ESTÁS VISITANDO A:', style: TextStyle(color: Colors.yellow, fontSize: 10, fontWeight: FontWeight.bold)),
                Text(_activeVisit!['customer_name'] ?? 'Cargando...', 
                     style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          const Badge(label: Text('ACTIVA'), backgroundColor: Colors.yellow, textColor: Colors.black),
        ],
      ),
    );
  }

  Widget _buildCustomerCard(Map<String, dynamic> c, int order) {
    final status = c['visit_status'];
    final isCompleted = status == 'completed';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF242740),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isCompleted ? Colors.green.withOpacity(0.3) : Colors.white10),
      ),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: isCompleted ? Colors.green : const Color(0xFF6C63FF),
            radius: 15,
            child: Text('$order', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c['name'], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                Text(c['address'] ?? 'Sin dirección', 
                     style: const TextStyle(color: Colors.white54, fontSize: 12),
                     maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          _buildStatusTag(status),
        ],
      ),
    );
  }

  Widget _buildStatusTag(String? status) {
    String label = 'PENDIENTE';
    Color color = Colors.white24;
    Color textColor = Colors.white54;

    if (status == 'completed') {
      label = 'VISITADO';
      color = Colors.green.withOpacity(0.2);
      textColor = Colors.greenAccent;
    } else if (status == 'ongoing') {
      label = 'ACTUAL';
      color = Colors.yellow.withOpacity(0.2);
      textColor = Colors.yellowAccent;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label, style: TextStyle(color: textColor, fontSize: 9, fontWeight: FontWeight.bold)),
    );
  }
}
