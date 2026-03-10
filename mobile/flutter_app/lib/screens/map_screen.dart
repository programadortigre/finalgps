import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_background_service/flutter_background_service.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  GoogleMapController? _controller;
  LatLng _currentPos = const LatLng(-12.0464, -77.0428); // Default Lima
  String _currentState = 'Desconocido';
  double _currentSpeed = 0.0;

  @override
  void initState() {
    super.initState();
    _trackSelf();
    _listenBackgroundUpdates();
  }

  void _listenBackgroundUpdates() {
    FlutterBackgroundService().on('update').listen((event) {
      if (event != null && mounted) {
        setState(() {
          _currentPos = LatLng(event['lat'], event['lng']);
          _currentState = event['state'] ?? 'Desconocido';
          _currentSpeed = (event['speed'] as num).toDouble();
        });
        _controller?.animateCamera(CameraUpdate.newLatLng(_currentPos));
      }
    });
  }

  _trackSelf() async {
    Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
      )
    ).listen((pos) {
      if (mounted) {
        setState(() {
          _currentPos = LatLng(pos.latitude, pos.longitude);
          // La velocidad aquí es inmediata, el background service hace el cálculo semántico
        });
        _controller?.animateCamera(CameraUpdate.newLatLng(_currentPos));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My GPS Status'),
        actions: [
          IconButton(
            icon: const Icon(Icons.power_settings_new, color: Colors.red),
            onPressed: () {
               FlutterBackgroundService().invoke('stopService');
            },
          )
        ],
      ),
      body: Stack(
        children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(target: _currentPos, zoom: 15),
            onMapCreated: (c) => _controller = c,
            myLocationEnabled: true,
            markers: {
              Marker(markerId: const MarkerId('me'), position: _currentPos)
            },
          ),
          Positioned(
            bottom: 16,
            left: 16,
            right: 16,
            child: Card(
              elevation: 4,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.radar, color: Colors.blue),
                        const SizedBox(width: 8),
                        Text(
                          'Estado: $_currentState',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                      ],
                    ),
                    const Divider(),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Velocidad: ${_currentSpeed.toStringAsFixed(1)} km/h'),
                            Text('Lat: ${_currentPos.latitude.toStringAsFixed(6)}'),
                            Text('Lng: ${_currentPos.longitude.toStringAsFixed(6)}'),
                          ],
                        ),
                        const Icon(Icons.directions_walk, size: 32, color: Colors.grey),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          )
        ],
      ),
    );
  }
}
