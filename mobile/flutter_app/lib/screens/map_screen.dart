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

  @override
  void initState() {
    super.initState();
    _trackSelf();
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
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.check_circle, color: Colors.green),
                        SizedBox(width: 8),
                        Text('Tracking en segundo plano activo', fontStyle: FontStyle.italic),
                      ],
                    ),
                    const Divider(),
                    Text('Lat: ${_currentPos.latitude.toStringAsFixed(6)}'),
                    Text('Lng: ${_currentPos.longitude.toStringAsFixed(6)}'),
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
