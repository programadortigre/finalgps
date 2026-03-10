import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ────────────────────────────────────────────────────────────────────────────
// 🔧 PRESET SERVER URLS
// Add/remove entries here as needed. The first one is the default.
// ────────────────────────────────────────────────────────────────────────────
const List<Map<String, String>> kServerPresets = [
  {'label': '🌐 Servidor Zyma', 'url': 'https://zyma.lat'},
  {'label': '🏠 Local (Dev)',     'url': 'http://192.168.0.102:3000'},
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
  Future<Dio> _getDio() async {
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
      final dio = await _getDio();
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
          await _storage.write(key: 'user_name', value: user['name'] ?? '');
          await _storage.write(key: 'user_role', value: user['role'] ?? '');
          await _storage.write(key: 'user_email', value: email);
        }
        return token;
      }
    } on DioException catch (e) {
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return '__timeout__';
      }
    } catch (_) {}
    return null;
  }

  Future<bool> uploadBatch(List<Map<String, dynamic>> points) async {
    final token = await _storage.read(key: 'token');
    if (token == null) return false;
    try {
      final dio = await _getDio();
      final res = await dio.post(
        '/api/locations/batch',
        data: {'points': points},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      return res.statusCode == 202;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>?> fetchTodayRoute() async {
    final token = await _storage.read(key: 'token');
    if (token == null) return null;
    try {
      final dio = await _getDio();
      final now = DateTime.now();
      final todayStr = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      
      final res = await dio.get(
        '/api/trips?date=$todayStr',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      
      if (res.statusCode == 200 && res.data != null && (res.data as List).isNotEmpty) {
        final trips = res.data as List;
        // Tomamos el viaje más reciente (el primero por ORDER BY start_time DESC)
        final latestTrip = trips[0];
        final latestTripId = latestTrip['id'];
        final distanceMeters = latestTrip['distance_meters'] ?? 0.0;
        
        final detailsRes = await dio.get(
          '/api/trips/$latestTripId',
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        );
        
        if (detailsRes.statusCode == 200 && detailsRes.data != null) {
          return {
            'distance_meters': distanceMeters,
            'points': detailsRes.data['points'] ?? [],
            'trip_id': latestTripId,
          };
        }
      }
    } catch (e) {
      // Ignored
    }
    return null;
  }

  Future<String?> getToken() => _storage.read(key: 'token');
  Future<String?> getUserName() => _storage.read(key: 'user_name');
  Future<String?> getUserRole() => _storage.read(key: 'user_role');
  Future<String?> getUserEmail() => _storage.read(key: 'user_email');

  Future<void> logout() async {
    await _storage.delete(key: 'token');
    await _storage.delete(key: 'user_name');
    await _storage.delete(key: 'user_role');
    await _storage.delete(key: 'user_email');
  }
}
