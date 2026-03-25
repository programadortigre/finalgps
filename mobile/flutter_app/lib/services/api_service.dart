import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ────────────────────────────────────────────────────────────────────────────
// 🔧 PRESET SERVER URLS
// Add/remove entries here as needed. The first one is the default.
// ────────────────────────────────────────────────────────────────────────────
const List<Map<String, String>> kServerPresets = [
  {'label': '🌐 Elyon GPS',    'url': 'https://elyongps.com'},
  {'label': '🌐 Servidor Zyma', 'url': 'https://zyma.lat'},
  {'label': '🏠 Local (Dev)',     'url': 'http://10.0.2.2:3000'}, // Standard Android Emulator localhost
];

const String _kServerUrlKey = 'server_url';

class ApiService {
  static String? _cachedUrl;
  Dio? _dio;

  final _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  /// Returns the currently configured server URL.
  /// Falls back to the first preset if nothing is saved.
  static Future<String> getServerUrl() async {
    if (_cachedUrl != null) return _cachedUrl!;
    final prefs = await SharedPreferences.getInstance();
    _cachedUrl = prefs.getString(_kServerUrlKey) ?? kServerPresets.first['url']!;
    return _cachedUrl!;
  }

  /// Save a new server URL (from login screen).
  static Future<void> setServerUrl(String url) async {
    final clean = url.trimRight().endsWith('/')
        ? url.trimRight().substring(0, url.trimRight().length - 1)
        : url.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kServerUrlKey, clean);
    _cachedUrl = clean;
  }

  /// Lazy-init Dio with the saved URL
  Future<Dio> getDio() async {
    if (_dio != null) return _dio!;
    final url = await getServerUrl();
    _dio = Dio(BaseOptions(
      baseUrl: url,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 20),
    ));
    return _dio!;
  }

  /// Force Dio to reconfigure (call after changing server URL)
  void resetDio() {
    _dio = null;
  }

  Future<String?> login(String email, String password) async {
    try {
      final dio = await getDio();
      final res = await dio.post('/api/auth/login', data: {
        'email': email,
        'password': password,
      });
      if (res.statusCode == 200) {
        final token = res.data['accessToken'];
        await _storage.write(key: 'token', value: token);
        // Save user info
        final user = res.data['user'];
        if (user != null) {
          await _storage.write(key: 'user_id', value: (user['id'] ?? '').toString());
          await _storage.write(key: 'user_name', value: user['name'] ?? '');
          await _storage.write(key: 'user_role', value: user['role'] ?? '');
          await _storage.write(key: 'user_email', value: email);
        }
        return token;
      }
    } on DioException catch (e) {
      final msg = e.response?.data?['message'] ?? e.message;
      print('[ApiService] Error de Login (${e.type}): $msg');
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return '__timeout__';
      }
    } catch (e) {
      print('[ApiService] Error inesperado en Login: $e');
    }
    return null;
  }

  Future<bool> uploadBatch(List<Map<String, dynamic>> points) async {
    final token = await _storage.read(key: 'token');
    final userIdStr = await _storage.read(key: 'user_id');
    final employeeId = int.tryParse(userIdStr ?? '');
    if (token == null || employeeId == null) return false;
    try {
      final dio = await getDio();
      // Asegura que cada punto tenga employeeId
      final enrichedPoints = points.map((p) {
        final copy = Map<String, dynamic>.from(p);
        copy['employeeId'] = employeeId;
        return copy;
      }).toList();
      print('[FLOW-DIAG] API Submitting batch of ${enrichedPoints.length} points to /api/locations/batch');
      final res = await dio.post(
        '/api/locations/batch',
        data: {'points': enrichedPoints},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      
      print('[FLOW-DIAG] API Response (${res.statusCode}): ${res.data}');
      
      if (res.statusCode == 202) {
        print('[ApiService] Batch subido con éxito: ${enrichedPoints.length} puntos');
        return true;
      } else {
        print('[ApiService] Error batch (${res.statusCode}): ${res.data}');
        return false;
      }
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      String error = e.message ?? 'Unknown error';
      
      // FIX: Evitar error "String is not a subtype of int of index" si la respuesta es HTML/Texto
      if (e.response?.data != null && e.response?.data is Map) {
        error = e.response?.data['message'] ?? error;
      }
      
      print('[ApiService] DioError en uploadBatch ($status): $error');
      return false;
    } catch (e) {
      print('[ApiService] Error fatal en uploadBatch: $e');
      return false;
    }
  }

  Future<List<Map<String, dynamic>>?> fetchTodayRoutes() async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final now = DateTime.now();
      final todayStr = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      
      final res = await dio.get(
        '/api/trips?date=$todayStr',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      
      if (res.statusCode == 200 && res.data != null && (res.data as List).isNotEmpty) {
        final trips = res.data as List;
        List<Map<String, dynamic>> allRoutes = [];
        for (var trip in trips) {
          final detailsRes = await dio.get(
            '/api/trips/${trip['id']}',
            options: Options(headers: {'Authorization': 'Bearer $token'}),
          );
          if (detailsRes.statusCode == 200 && detailsRes.data != null) {
            allRoutes.add({
              'distance_meters': trip['distance_meters'] ?? 0.0,
              'points': detailsRes.data['points'] ?? [],
              'trip_id': trip['id'],
            });
          }
        }
        return allRoutes;
      }
    } catch (e) {
      // Ignored
    }
    return null;
  }

  Future<List<Map<String, dynamic>>?> fetchAllLocations() async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/locations',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return List<Map<String, dynamic>>.from(res.data);
      }
    } catch (_) {}
    return null;
  }

  Future<String?> getToken() async {
    try {
      return await _storage.read(key: 'token');
    } catch (_) {
      return null;
    }
  }

  Future<String?> getUserName() async {
    try {
      return await _storage.read(key: 'user_name');
    } catch (_) {
      return null;
    }
  }

  Future<String?> getUserRole() async {
    try {
      return await _storage.read(key: 'user_role');
    } catch (_) {
      return null;
    }
  }

  Future<String?> getUserEmail() async {
    try {
      return await _storage.read(key: 'user_email');
    } catch (_) {
      return null;
    }
  }

  Future<String?> getUserId() async {
    try {
      return await _storage.read(key: 'user_id');
    } catch (_) {
      return null;
    }
  }

  /// 📍 Obtener historial de viajes por rango de fechas (NUEVO ENDPOINT)
  Future<List<Map<String, dynamic>>?> fetchTripHistory(int employeeId, String startDate, String endDate) async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/trips/history/$employeeId?startDate=$startDate&endDate=$endDate',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return List<Map<String, dynamic>>.from(res.data['trips']);
      }
    } catch (e) {
      print('[ApiService] Error fetching trip history: $e');
    }
    return null;
  }

  /// 📍 Obtener historial de paradas por rango de fechas (NUEVO ENDPOINT)
  Future<List<Map<String, dynamic>>?> fetchStopHistory(int employeeId, String startDate, String endDate) async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/trips/stops/history/$employeeId?startDate=$startDate&endDate=$endDate',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return List<Map<String, dynamic>>.from(res.data['stops']);
      }
    } catch (e) {
      print('[ApiService] Error fetching stop history: $e');
    }
    return null;
  }

  /// 📍 Obtener historial de viajes de un vendedor por fecha (legacy)
  Future<List<Map<String, dynamic>>?> fetchTripsForEmployee(int employeeId, String date) async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/trips?employeeId=$employeeId&date=$date',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return List<Map<String, dynamic>>.from(res.data);
      }
    } catch (_) {}
    return null;
  }

  /// 📍 Obtener detalles completos de un viaje con paradas y ruta
  Future<Map<String, dynamic>?> fetchTripDetails(int tripId) async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/trips/$tripId',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return res.data as Map<String, dynamic>;
      }
    } catch (_) {}
    return null;
  }

  /// 👥 Obtener lista de todos los empleados (solo para admins)
  Future<List<Map<String, dynamic>>?> fetchEmployees() async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/employees',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return List<Map<String, dynamic>>.from(res.data);
      }
    } catch (_) {}
    return null;
  }

  /// 📍 Obtener paradas de un viaje
  Future<List<Map<String, dynamic>>?> fetchStopsForTrip(int tripId) async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/trips/$tripId/stops',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return List<Map<String, dynamic>>.from(res.data);
      }
    } catch (_) {}
    return null;
  }

  Future<bool> updateStatus(String status) async {
    try {
      final token = await getToken();
      if (token == null) return false;
      
      final dio = await getDio(); // Use getDio() instead of _dio
      final response = await dio.post(
        '/api/locations/status', // Added /api prefix
        data: {'state': status},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      return response.statusCode == 200;
    } catch (e) {
      // debugPrint('Error en updateStatus: $e'); // Removed debugPrint as it's not defined
      return false;
    }
  }

  /// 👥 Obtener perfil propio
  Future<Map<String, dynamic>?> fetchMyProfile() async {
    final token = await getToken();
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/employees/me',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return res.data;
      }
    } catch (e) {
      print('[ApiService] Error fetching profile: $e');
    }
    return null;
  }

  /// 📍 Obtener ruta asignada para hoy
  Future<Map<String, dynamic>?> fetchMyRoute() async {
    final token = await getToken();
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/routes/me/route',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return res.data;
      }
    } catch (e) {
      print('[ApiService] Error fetching route: $e');
    }
    return null;
  }

  /// 📍 Obtener visita activa
  Future<Map<String, dynamic>?> fetchActiveVisit() async {
    final token = await getToken();
    if (token == null) return null;
    try {
      final dio = await getDio();
      final res = await dio.get(
        '/api/routes/me/active-visit',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (res.statusCode == 200) {
        return res.data;
      }
    } catch (e) {
      print('[ApiService] Error fetching active visit: $e');
    }
    return null;
  }

  /// 📍 Actualizar estado de rastreo (Sincronización con Admin Panel)
  Future<bool> updateTrackingStatus(bool enabled) async {
    final token = await getToken();
    final userId = await getUserId();
    if (token == null || userId == null) return false;
    try {
      final dio = await getDio();
      final res = await dio.patch(
        '/api/employees/$userId/tracking',
        data: {'enabled': enabled},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      return res.statusCode == 200;
    } catch (e) {
      print('[ApiService] Error updating tracking status: $e');
      return false;
    }
  }

  Future<void> logout() async {
    await _storage.delete(key: 'token');
    await _storage.delete(key: 'user_name');
    await _storage.delete(key: 'user_role');
    await _storage.delete(key: 'user_email');
  }
}
