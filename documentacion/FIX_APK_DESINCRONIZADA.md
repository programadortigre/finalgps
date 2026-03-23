# 🔧 FIX CRÍTICO - APK Desincronizada y Servicio Muere

## 📋 Diagnóstico

### Problema 1: Servicio se mata ❌
- **Causa**: Android mata procesos en background después de 1-2 minutos
- **Síntoma**: Ubicación se detiene sin razón aparente
- **Solución**: Mantener servicio en FOREGROUND con notificación persistente

### Problema 2: Ubicaciones raras/desincronizadas ❌
- **Causa**: Socket se desconecta silenciosamente
- **Síntoma**: Mapa dibuja saltos anormales o ruta desconectada
- **Solución**: Heartbeat + Reconexión automática exponencial

### Problema 3: Puntos duplicados ❌
- **Causa**: Buffer sin deduplicación
- **Síntoma**: Puntos exactamente iguales en BD
- **Solución**: Filtro de duplicados antes de guardar

---

## ✅ IMPLEMENTACIÓN (PASO A PASO)

### PASO 1: Agregar imports en `login_screen.dart`

```diff
import '../services/api_service.dart';
import '../services/socket_service.dart';
+ import '../services/foreground_service_handler.dart';
+ import '../services/socket_reconnection_manager.dart';
+ import '../services/gps_buffer_manager.dart';
```

### PASO 2: Inicializar managers en login

En la función `_login()`, después de `_api.login()`:

```dart
// ✅ Agregar esto después de login exitoso:
final token = await _api.login(_emailCtrl.text.trim(), _passCtrl.text);
if (token != null) {
  // ✅ NUEVO: Inicializar servicio en foreground
  await ForegroundServiceHandler.setupAndMaintainForeground();
  
  // ✅ NUEVO: Inicializar reconexión de socket
  await SocketReconnectionManager().connect(token);
  
  // ✅ NUEVO: Inicializar buffer de GPS
  final storage = LocalStorage();
  final bufferManager = GPSBufferManager(storage: storage);
  bufferManager.start();
  
  // Ir a tracking screen
  if (mounted) {
    Navigator.pushReplacement(
      context, 
      MaterialPageRoute(builder: (_) => const TrackingScreen())
    );
  }
}
```

### PASO 3: Actualizar `background_service.dart`

Reemplazar la línea de `_emitToSocket` con:

```dart
// ANTES (línea ~1115):
_emitToSocket(point);

// DESPUÉS:
if (_socket != null && _socket!.connected) {
  _socket!.emit('location_update', point.toJson());
  _log('SOCKET', '📍 Ubicación emitida en tiempo real');
} else {
  _log('SOCKET', '⚠️ Socket no conectado. En buffer local.');
}
```

Y actualizar la notificación del servicio (línea ~1145):

```dart
// ANTES:
_serviceInstance?.invoke('trackingLocation', {...});

// DESPUÉS:
_serviceInstance?.invoke('trackingLocation', {/*...*/});

// NUEVO: Actualizar notificación cada vez
if (_serviceInstance is AndroidServiceInstance) {
  await ForegroundServiceHandler.updateNotificationWithLiveData(
    title: '📍 ${_currentState.name}',
    content: '${speedKmh.toStringAsFixed(1)} km/h | ${(totalDistanceKm).toStringAsFixed(2)} km',
  );
}
```

### PASO 4: Agregar GPSBufferManager al background_service.dart

En la clase `TrackingEngine`, agregar:

```dart
// En el constructor
late GPSBufferManager _bufferManager;

// En start()
_bufferManager = GPSBufferManager(storage: _storage);
_bufferManager.start();

// En _addToBufferAndFlush (línea ~1080)
// REEMPLAZAR este código:
await _addToBufferAndFlush(point.toJson());

// CON ESTO:
await _bufferManager.addPoint(point);

// Al detener
void dispose() {
  _bufferManager.stop();
  // ... resto del cleanup
}
```

### PASO 5: Permisos en AndroidManifest.xml (verificar)

✅ **YA TIENES ESTOS**, pero verificar que existan:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
```

---

## 🧪 TESTS DESPUÉS DE IMPLEMENTAR

### Test 1: Servicio no se mata en background
1. Abrir app y loguear
2. Ver notificación "📍 GPS Activo" (persistente)
3. Presionar Home (minimizar)
4. Esperar 5 minutos
5. Volver a app → ✅ Debería seguir rastreando

### Test 2: Socket se reconecta automáticamente
1. Abrir app
2. Apagar WiFi
3. Ver logs: `[Socket] ⚠️ Desconectado`
4. Esperar 10 segundos
5. Prender WiFi
6. Ver logs: `[Socket] ✅ Conectado!` → ✅ Auto-reconexión

### Test 3: Sin puntos duplicados
1. Rastrear durante 1-2 min
2. Enviar a servidor
3. En DB: `SELECT * FROM locations WHERE employee_id = X ORDER BY timestamp`
4. Verificar que NO HAY puntos exactamente iguales

### Test 4: Mapa dibuja ruta correcta
1. Caminar/manejar ruta específica
2. Abrir admin panel
3. Ver ruta en mapa en tiempo real
4. Debería ser continua sin saltos

---

## 📊 Resultado Esperado

### Antes (Broken ❌):
```
- Servicio se mata en 1-2 min
- Socket se desconecta silenciosamente
- Mapa dibuja saltos locos
- BD llena de duplicados
- Ubicación "atrasada"
```

### Después (Fixed ✅):
```
✅ Servicio corre 24/7 con notificación
✅ Socket se reconecta automáticamente
✅ Mapa dibuja ruta fluida
✅ Sin duplicados en BD
✅ Ubicación en tiempo real
```

---

## 🐛 Si Aún Hay Problemas

### Problema: Notificación desaparece
```
Solución: En LoginScreen, después de login, agregar:
await ForegroundServiceHandler.setupAndMaintainForeground();
```

### Problema: Socket aún se desconecta
```
Solución: Verificar que está en socket_reconnection_manager.dart
y que se inicializa en login.
```

### Problema: Muchas ubicaciones en rápida sucesión
```
Solución: El GPSBufferManager deduplica automáticamente.
Si sigue, aumentar el threshold de duplicado en gps_buffer_manager.dart línea 35:
if ((point.timestamp - lastPoint.timestamp).abs() < 2000) { // Cambiar a 5000
```

---

## 📁 Archivos Nuevos Creados

```
lib/services/
├── foreground_service_handler.dart   ✅ NUEVO
├── socket_reconnection_manager.dart  ✅ NUEVO
└── gps_buffer_manager.dart           ✅ NUEVO
```

**Copiar estos 3 archivos de la carpeta `download` o creadores en VS Code**

---

## ⏱️ Tiempo de Implementación

- **Total**: 15-20 minutos
- Copiar 3 archivos: 5 min
- Modificar login_screen.dart: 5 min
- Modificar background_service.dart: 5 min
- Verificar permisos: 2 min
- Test: 5-10 min

---

**¡Implementa esto y se arregla!** 🚀
