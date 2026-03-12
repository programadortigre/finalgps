import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';

class AdminMonitoringScreen extends StatefulWidget {
  const AdminMonitoringScreen({super.key});

  @override
  State<AdminMonitoringScreen> createState() => _AdminMonitoringScreenState();
}

class _AdminMonitoringScreenState extends State<AdminMonitoringScreen> {
  final MapController _mapCtrl = MapController();
  final _api = ApiService();
  
  Map<int, Map<String, dynamic>> _vendors = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _initData();
  }

  Future<void> _initData() async {
    final initial = await _api.fetchAllLocations();
    if (initial != null && mounted) {
      setState(() {
        for (var loc in initial) {
          _vendors[loc['employeeId']] = {
            ...loc,
            'lastUpdate': DateTime.now().toIso8601String(),
          };
        }
        _loading = false;
      });
    }

    SocketService.onLocationUpdate = (data) {
      if (mounted) {
        setState(() {
          _vendors[data['employeeId']] = {
            ...data,
            'lastUpdate': DateTime.now().toIso8601String(),
          };
        });
      }
    };
    
    final token = await _api.getToken();
    if (token != null) {
      await SocketService.init(token);
    }
  }

  @override
  void dispose() {
    SocketService.disconnect();
    super.dispose();
  }

  Color _getStateColor(String? state) {
    switch (state?.toUpperCase()) {
      case 'QUIETO':
      case 'OFFLINE': 
      case 'SIN_MOVIMIENTO': return const Color(0xFF94A3B8);
      case 'A PIE':
      case 'CAMINANDO': return const Color(0xFF22C55E);
      case 'LENTO':
      case 'MOVIMIENTO_LENTO': return const Color(0xFFF59E0B);
      case 'EN AUTO':
      case 'VEHICULO': return const Color(0xFF6366F1);
      default: return const Color(0xFF2563EB);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      body: Stack(children: [
        FlutterMap(
          mapController: _mapCtrl,
          options: const MapOptions(
            initialCenter: LatLng(-12.0464, -77.0428),
            initialZoom: 13,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              subdomains: const ['a', 'b', 'c', 'd'],
            ),
            MarkerLayer(
              markers: _vendors.values.map((v) {
                final lat = (v['lat'] as num).toDouble();
                final lng = (v['lng'] as num).toDouble();
                final state = v['state'] as String?;
                final color = _getStateColor(state);
                
                return Marker(
                  point: LatLng(lat, lng),
                  width: 60, height: 60,
                  child: GestureDetector(
                    onTap: () {
                      _mapCtrl.move(LatLng(lat, lng), 17);
                      _showVendorInfo(v);
                    },
                    child: Stack(alignment: Alignment.center, children: [
                      Container(
                        width: 14, height: 14,
                        decoration: BoxDecoration(
                          color: color,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 2.5),
                          boxShadow: [BoxShadow(color: color.withOpacity(0.6), blurRadius: 8, spreadRadius: 2)],
                        ),
                      ),
                      if (state != 'Quieto' && state != 'Offline' && state != 'SIN_MOVIMIENTO') 
                         TweenAnimationBuilder(
                           tween: Tween(begin: 0.0, end: 1.0),
                           duration: const Duration(seconds: 1),
                           builder: (context, double value, child) => Container(
                             width: 24 * value, height: 24 * value,
                             decoration: BoxDecoration(
                               shape: BoxShape.circle,
                               border: Border.all(color: color.withOpacity(1.0 - value), width: 1),
                             ),
                           ),
                         ),
                    ]),
                  ),
                );
              }).toList(),
            ),
          ],
        ),

        // Header
        Positioned(
          top: 0, left: 0, right: 0,
          child: Container(
            padding: EdgeInsets.fromLTRB(16, MediaQuery.of(context).padding.top + 8, 16, 16),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter, end: Alignment.bottomCenter,
                colors: [const Color(0xFF1A1A2E), const Color(0xFF1A1A2E).withOpacity(0)],
              ),
            ),
            child: Row(children: [
              IconButton(
                icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 20),
                onPressed: () => Navigator.pop(context),
              ),
              const Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Panel de Monitoreo', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                  Text('Vendedores en tiempo real', style: TextStyle(color: Color(0xFF8B8FA8), fontSize: 12)),
                ]),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: const Color(0xFF6C63FF), borderRadius: BorderRadius.circular(20)),
                child: Text('${_vendors.length} Activos', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
              ),
            ]),
          ),
        ),

        if (_loading) const Center(child: CircularProgressIndicator(color: Color(0xFF6C63FF))),

        // Legend Overlay
        Positioned(
          bottom: 30, right: 20,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A2E).withOpacity(0.9),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withOpacity(0.1)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
               _legendRow(const Color(0xFF94A3B8), 'Detenido'),
               const SizedBox(height: 6),
               _legendRow(const Color(0xFF22C55E), 'Caminando'),
               const SizedBox(height: 6),
               _legendRow(const Color(0xFF6366F1), 'Vehículo'),
            ]),
          ),
        ),
      ]),
    );
  }

  Widget _legendRow(Color color, String label) => Row(children: [
    Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
    const SizedBox(width: 10),
    Text(label, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w500)),
  ]);

  void _showVendorInfo(Map<String, dynamic> loc) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A1A2E),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Container(
              width: 50, height: 50,
              decoration: BoxDecoration(color: const Color(0xFF6C63FF), borderRadius: BorderRadius.circular(15)),
              child: const Icon(Icons.person, color: Colors.white, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(loc['name'] ?? 'Vendedor ${loc['employeeId']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                Text(loc['email'] ?? 'Vendedor activo', style: const TextStyle(color: Color(0xFF8B8FA8), fontSize: 13)),
            ])),
          ]),
          const SizedBox(height: 24),
          Row(children: [
            _miniStat('Velocidad', '${(loc['speed'] as num? ?? 0).toStringAsFixed(1)} km/h'),
            const SizedBox(width: 12),
            _miniStat('Estado', (loc['state'] as String? ?? 'Quieto')),
          ]),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF6C63FF),
              minimumSize: const Size(double.infinity, 50),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text('CERRAR', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ]),
      ),
    );
  }

  Widget _miniStat(String label, String value) => Expanded(
    child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF242740), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: Color(0xFF8B8FA8), fontSize: 11)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
      ]),
    ),
  );
}
