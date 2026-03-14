import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final ApiService _api = ApiService();
  GoogleMapController? _controller;
  
  // 🎛️ Estado general
  late String _userRole;
  late String _userName;
  LatLng _currentPos = const LatLng(-12.0464, -77.0428);
  
  // 💾 Data
  List<Map<String, dynamic>> _employees = [];
  Map<String, dynamic>? _selectedEmployee;
  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _trips = [];
  Map<String, dynamic>? _selectedTrip;
  
  // 🗺️ Map data
  Set<Marker> _markers = {};
  Set<Polyline> _polylines = {};
  bool _isLoading = false;
  String? _errorMsg;
  
  // ⏱️ Debounce para actualizaciones de socket (evitar redibujarse tanto)
  final Map<String, Timer> _updateTimers = {};
  final Map<String, Map<String, dynamic>> _pendingUpdates = {};

  @override
  void initState() {
    super.initState();
    _initScreen();
  }

  Future<void> _initScreen() async {
    try {
      final role = await _api.getUserRole();
      final name = await _api.getUserName();
      
      setState(() {
        _userRole = role ?? 'vendor';
        _userName = name ?? 'Usuario';
      });

      // Track own location
      _trackSelf();

      // If admin, fetch employees
      if (_userRole == 'admin') {
        await _fetchEmployees();
      }

      // Connect to socket for real-time updates
      await _connectSocket();
    } catch (e) {
      setState(() => _errorMsg = 'Error al inicializar: $e');
    }
  }

  Future<void> _trackSelf() async {
    Geolocator.getPositionStream(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.best,  // ✅ Máxima precisión en tiempo real
        distanceFilter: 2,  // 🚀 Actualizar cada 2 metros (más fluido)
        intervalDuration: const Duration(seconds: 2),  // 🚀 Cada 2 segundos
      ),
    ).listen((pos) {
      if (mounted) {
        setState(() => _currentPos = LatLng(pos.latitude, pos.longitude));
        // 🎥 Animar cámara suavemente
        _controller?.animateCamera(
          CameraUpdate.newLatLng(_currentPos),
        );
      }
    });
  }

  Future<void> _connectSocket() async {
    final token = await _api.getToken();
    if (token == null) return;
    
    SocketService.init(token);
    
    // 🚀 Escuchar actualizaciones en tiempo real con debounce
    SocketService.onLocationUpdate = (data) {
      if (mounted && _userRole == 'admin') {
        final empId = data['employeeId'].toString();
        
        // Guardar la actualización pendiente
        _pendingUpdates[empId] = data;
        
        // Cancelar timer anterior si existe
        _updateTimers[empId]?.cancel();
        
        // Crear nuevo timer con debounce de 300ms (balance fluuidez/rendimiento)
        _updateTimers[empId] = Timer(const Duration(milliseconds: 300), () {
          if (mounted && _pendingUpdates.containsKey(empId)) {
            _addEmployeeMarker(_pendingUpdates[empId]!);
            _updateTimers.remove(empId);
            _pendingUpdates.remove(empId);
          }
        });
      }
    };
  }

  Future<void> _fetchEmployees() async {
    setState(() => _isLoading = true);
    try {
      final employees = await _api.fetchEmployees();
      if (employees != null) {
        setState(() => _employees = employees);
        if (_employees.isNotEmpty) {
          _selectedEmployee = _employees[0];
          await _fetchTripsForSelectedEmployee();
        }
      }
    } catch (e) {
      setState(() => _errorMsg = 'Error al cargar vendedores: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _fetchTripsForSelectedEmployee() async {
    if (_selectedEmployee == null) return;
    
    setState(() => _isLoading = true);
    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);
      // ✅ MEJORADO: Usar el nuevo endpoint de historial por rango (aunque sea el mismo día por ahora)
      final history = await _api.fetchTripHistory(_selectedEmployee!['id'], dateStr, dateStr);
      
      if (history != null) {
        setState(() {
          _trips = history;
          if (_trips.isNotEmpty) {
            _selectedTrip = _trips[0];
            _loadTrip(_selectedTrip!['id']);
          } else {
            _clearMap();
          }
        });
      }
    } catch (e) {
      setState(() => _errorMsg = 'Error al cargar historial: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadTrip(int tripId) async {
    setState(() => _isLoading = true);
    try {
      final tripData = await _api.fetchTripDetails(tripId);
      final stops = await _api.fetchStopsForTrip(tripId);

      if (tripData != null) {
        _buildMapFromTrip(tripData, stops ?? []);
      }
    } catch (e) {
      setState(() => _errorMsg = 'Error al cargar ruta: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _buildMapFromTrip(Map<String, dynamic> trip, List<Map<String, dynamic>> stops) {
    final markers = <Marker>{};
    final polylines = <Polyline>{};

    // ✅ Obtener puntos de la ruta
    final points = trip['points'] as List?;
    if (points != null && points.isNotEmpty) {
      final List<LatLng> routePoints = points.map<LatLng>((p) {
        return LatLng(
          (p['latitude'] as num).toDouble(),
          (p['longitude'] as num).toDouble(),
        );
      }).toList();

      // 📍 Dibujar ruta
      if (routePoints.length > 1) {
        polylines.add(
          Polyline(
            polylineId: const PolylineId('route'),
            points: routePoints,
            color: Colors.blueAccent,
            width: 4,
            geodesic: true,
          ),
        );
      }

      // 🚀 Marcador de inicio
      markers.add(
        Marker(
          markerId: const MarkerId('start'),
          position: routePoints.first,
          infoWindow: const InfoWindow(title: '🚀 Inicio jornada'),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
        ),
      );

      // 🏁 Marcador de fin
      markers.add(
        Marker(
          markerId: const MarkerId('end'),
          position: routePoints.last,
          infoWindow: const InfoWindow(title: '🏁 Fin jornada'),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        ),
      );
    }

    // 🛑 Agregar paradas
    for (int i = 0; i < stops.length; i++) {
      final stop = stops[i];
      final lat = (stop['latitude'] as num).toDouble();
      final lng = (stop['longitude'] as num).toDouble();
      final duration = stop['duration_seconds'] as int?;
      
      markers.add(
        Marker(
          markerId: MarkerId('stop_$i'),
          position: LatLng(lat, lng),
          infoWindow: InfoWindow(
            title: 'Parada ${i + 1}',
            snippet: '⏱ ${_formatDuration(duration ?? 0)}',
            onTap: () => _openGoogleMaps(lat, lng),
          ),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
        ),
      );
    }

    setState(() {
      _markers = markers;
      _polylines = polylines;
    });

    // 🎬 Animar cámara al centro de la ruta
    if (_markers.isNotEmpty) {
      final avgLat = _markers.map((m) => m.position.latitude).reduce((a, b) => (a + b) / 2);
      final avgLng = _markers.map((m) => m.position.longitude).reduce((a, b) => (a + b) / 2);
      _controller?.animateCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(target: LatLng(avgLat, avgLng), zoom: 15),
        ),
      );
    }
  }

  void _addEmployeeMarker(Map<String, dynamic> data) {
    final marker = Marker(
      markerId: MarkerId('emp_${data['employeeId']}'),
      position: LatLng(data['lat'] as double, data['lng'] as double),
      infoWindow: InfoWindow(
        title: data['name'] ?? data['employeeName'] ?? 'Vendedor',
        snippet: 'En vivo: ${_formatTime(data['timestamp'])}',
      ),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueCyan),
    );

    setState(() {
      _markers = _markers
          .where((m) => m.markerId.value != 'emp_${data['employeeId']}')
          .toSet();
      _markers.add(marker);
    });
  }

  Future<void> _openGoogleMaps(double lat, double lng) async {
    final url = 'https://www.google.com/maps/?q=$lat,$lng';
    if (await canLaunchUrl(Uri.parse(url))) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    }
  }

  void _clearMap() {
    setState(() {
      _markers = {};
      _polylines = {};
    });
  }

  String _formatDuration(int seconds) {
    final minutes = seconds ~/ 60;
    final secs = seconds % 60;
    return '${minutes}m ${secs}s';
  }

  String _formatTime(int? timestamp) {
    if (timestamp == null) return '---';
    final dt = DateTime.fromMillisecondsSinceEpoch(timestamp);
    return DateFormat('HH:mm').format(dt);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0f172a),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0f172a),
        foregroundColor: Colors.white,
        title: Text(_userRole == 'admin' ? '👨‍💼 Panel Admin' : '💼 Mi Recorrido'),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.power_settings_new, color: Colors.redAccent),
            onPressed: () {
              FlutterBackgroundService().invoke('stopService');
              Navigator.pop(context);
            },
          ),
        ],
      ),
      body: Stack(
        children: [
          // 🗺️ Google Map
          GoogleMap(
            initialCameraPosition: CameraPosition(target: _currentPos, zoom: 15),
            onMapCreated: (c) => _controller = c,
            myLocationEnabled: true,
            myLocationButtonEnabled: true,
            zoomControlsEnabled: true,
            markers: _markers,
            polylines: _polylines,
            mapType: MapType.normal,
            style: _darkMapStyle,
          ),

          // Side panel (Admin only)
          if (_userRole == 'admin') _buildAdminSidePanel(),

          // Bottom info card
          Positioned(
            bottom: 16,
            left: 16,
            right: 16,
            child: _buildInfoCard(),
          ),

          // Loading overlay
          if (_isLoading)
            Container(
              color: Colors.black45,
              child: const Center(
                child: CircularProgressIndicator(color: Colors.blueAccent),
              ),
            ),

          // Error message
          if (_errorMsg != null)
            Positioned(
              top: 16,
              left: 16,
              right: 16,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.redAccent,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _errorMsg!,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildAdminSidePanel() {
    return Positioned(
      left: 0,
      top: 0,
      bottom: 0,
      width: 300,
      child: Container(
        color: const Color(0xFF1e293b),
        child: Column(
          children: [
            // 👥 Selector de vendedor
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Vendedor', style: TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(height: 8),
                  DropdownButton<Map<String, dynamic>>(
                    dropdownColor: const Color(0xFF0f172a),
                    style: const TextStyle(color: Colors.white),
                    isExpanded: true,
                    value: _selectedEmployee,
                    items: _employees.map<DropdownMenuItem<Map<String, dynamic>>>((emp) {
                      return DropdownMenuItem(
                        value: emp,
                        child: Text(emp['name'] ?? 'Sin nombre'),
                      );
                    }).toList(),
                    onChanged: (emp) {
                      setState(() => _selectedEmployee = emp);
                      _fetchTripsForSelectedEmployee();
                    },
                  ),
                ],
              ),
            ),

            // 📅 Selector de fecha
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      DateFormat('dd/MM/yyyy').format(_selectedDate),
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.calendar_today, color: Colors.blueAccent, size: 20),
                    onPressed: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _selectedDate,
                        firstDate: DateTime(2024),
                        lastDate: DateTime.now(),
                      );
                      if (picked != null) {
                        setState(() => _selectedDate = picked);
                        _fetchTripsForSelectedEmployee();
                      }
                    },
                  ),
                ],
              ),
            ),

            const Divider(color: Colors.white24),

            // 🚗 Lista de viajes
            Expanded(
              child: _trips.isEmpty
                  ? const Center(
                      child: Text('Sin viajes', style: TextStyle(color: Colors.white70, fontSize: 13)),
                    )
                  : ListView.builder(
                      itemCount: _trips.length,
                      itemBuilder: (ctx, i) {
                        final trip = _trips[i];
                        final isSelected = _selectedTrip?['id'] == trip['id'];
                        return ListTile(
                          selected: isSelected,
                          selectedTileColor: Colors.blue.withOpacity(0.3),
                          title: Text(
                            'Viaje ${i + 1}',
                            style: const TextStyle(color: Colors.white, fontSize: 13),
                          ),
                          subtitle: Text(
                            '${trip['distance_meters'] ?? 0}m • ${_formatDuration(trip['duration_seconds'] ?? 0)}',
                            style: const TextStyle(color: Colors.white70, fontSize: 11),
                          ),
                          onTap: () {
                            setState(() => _selectedTrip = trip);
                            _loadTrip(trip['id']);
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard() {
    final trip = _selectedTrip;
    return Card(
      color: const Color(0xFF1e293b),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_userRole == 'vendor')
              Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 18),
                  const SizedBox(width: 8),
                  Text(
                    'Tracking activo',
                    style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ],
              )
            else if (trip != null)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Viaje #${trip['id']}',
                    style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Icon(Icons.straighten, color: Colors.blueAccent, size: 16),
                      const SizedBox(width: 4),
                      Text(
                        '${((trip['distance_meters'] ?? 0) / 1000).toStringAsFixed(2)} km',
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      const SizedBox(width: 16),
                      const Icon(Icons.schedule, color: Colors.blueAccent, size: 16),
                      const SizedBox(width: 4),
                      Text(
                        '${trip['duration_minutes'] ?? _formatDuration(trip['duration_seconds'] ?? 0)} min',
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      const SizedBox(width: 16),
                      const Icon(Icons.location_on, color: Colors.orangeAccent, size: 16),
                      const SizedBox(width: 4),
                      Text(
                        '${trip['stop_count'] ?? 0} paradas',
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                    ],
                  ),
                ],
              )
            else
              const Text(
                'Selecciona un viaje para ver detalles',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
            const SizedBox(height: 8),
            Text(
              'Lat: ${_currentPos.latitude.toStringAsFixed(4)} | Lng: ${_currentPos.longitude.toStringAsFixed(4)}',
              style: const TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }

  static const String _darkMapStyle = '''
[
  {
    "elementType": "geometry",
    "stylers": [{"color": "#1f2937"}]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [{"color": "#1f2937"}]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [{"color": "#9ca3af"}]
  },
  {
    "featureType": "administrative.locality",
    "elementType": "labels.text.fill",
    "stylers": [{"color": "#d1d5db"}]
  },
  {
    "featureType": "water",
    "elementType": "geometry.fill",
    "stylers": [{"color": "#0f4c75"}]
  },
  {
    "featureType": "road",
    "elementType": "geometry.fill",
    "stylers": [{"color": "#374151"}]
  }
]
  ''';

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }
}

