# 🎯 Sistema de Rastreo Basado en Estados (State Machine)

## Problema Actual
- Socket.io listener es **frágil** en 3G
- Depende de conexión activa (drena batería)
- Congela el mapa cuando pierde conexión
- Recorridos erráticos por desincronización

## Solución: State Machine + Polling

### Arquitectura Nueva

```
┌─────────────────────────────────────────────────────────────────┐
│                     APP (Flutter)                               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  TrackingStateMachine                                    │  │
│  │  - STOPPED, WALKING, DRIVING, PAUSED, OFFLINE          │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  Background Service (cada 5-10 seg)                      │  │
│  │  1. Captura GPS + estado actual                          │  │
│  │  2. POST /api/locations/batch (con estado)              │  │
│  │  3. GET /api/locations/self (obtiene estado guardado)   │  │
│  │  4. Transiciona estado según respuesta                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         │ HTTP REST (más robusto en 3G)
         │
┌────────▼──────────────────────────────────────────────────────┐
│                    BACKEND API                                │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  POST /api/locations/batch                              │ │
│  │  Recibe: {lat, lng, accuracy, speed, activity, timestamp}│ │
│  │  - Valida GPS (Kalman Filter)                           │ │
│  │  - Detecta estado (WALKING/DRIVING/PAUSED)              │ │
│  │  - Guarda en DB + Redis (caché para admins)             │ │
│  │  - Responde: {state, routeId, eta, confidence}         │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  GET /api/locations/self                                │ │
│  │  Responde: Última ubicación validada + estado           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  LocationStateManager (Redis)                           │ │
│  │  - Mantiene estado de cada empleado                     │ │
│  │  - Admin Panel lee de Redis (no socket)                 │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
         │
         │ Redis PUBLISH (para admins conectados)
         │
┌────────▼──────────────────────────────────────────────────────┐
│                    Admin Panel Web                            │
│                                                                │
│  - Pulea /api/locations cada 2-3 seg (mucho menos que antes) │
│  - Recibe estado pre-calculado del servidor                  │
│  - Redis pub/sub OPCIONAL (para notificaciones inmediatas)   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Estados de Rastreo (Flow del APP)

```
STOPPED (Batería muy baja o rastreo pausado)
  ↓ (Batería > 20% y rastreo habilitado)
  ↓
DEEP_SLEEP (GPS apagado, polling mínimo cada 30 seg)
  │
  ├─→ WALKING (Acelerómetro detecta movimiento lento < 4 m/s)
  │   └─→ Polling cada 5 seg + GPS continuo
  │       └─→ Si speed > 4 m/s → DRIVING
  │
  └─→ DRIVING (GPS detecta velocidad > 4 m/s)
      └─→ Polling cada 3-5 seg + GPS continuo  
          └─→ Si speed < 1 m/s por 30 seg → WALKING/STOPPED

PAUSED (Admin lo pausó remotamente)
  └─→ Sin recolectar GPS, solo verificar comandos cada 30 seg
  
OFFLINE (Sin internet por > 1 minuto)
  └─→ Buffer local, reintenta conexión cada 10 seg
```

---

## Ventajas vs Socket.io

| Feature | Socket.io Anterior | State Machine Nuevo |
|---------|-------------------|-------------------|
| **Latencia** | 100-500ms (depende conexión) | 3-10s (polling + red) |
| **Robustez** | ❌ Se cae en 3G | ✅ Reintenta automático |
| **Batería** | 🔴 Alto (socket abierto) | 🟢 Bajo (HTTP + sleep) |
| **Recorridos** | Erráticos con gaps | Suave (server calcula ETA) |
| **Android Restrictions** | Limitado a 1 min wake-lock | ✅ WorkManager compatible |
| **Escalabilidad** | Socket por usuario | ✅ REST stateless |

---

## Cambios Necesarios

### 1️⃣ Backend API
```javascript
// NUEVA RUTA: POST /api/locations/batch
// Recibe estado + ubicación, valida, responde con estado calculado
```

### 2️⃣ Backend: LocationStateManager
```javascript
// Nuevo servicio que mantiene en Redis:
// locations:{employeeId} = {
//   lat, lng, state, speed, accuracy, 
//   eta, routeId, confidence, lastUpdate
// }
```

### 3️⃣ App Flutter
```dart
// REEMPLAZAR socket listener con polling timer
// Cada 5 seg: POST ubicación, GET estado actualizado
// UI escucha cambios de estado (no socket)
```

### 4️⃣ Admin Panel
```javascript
// Cambiar de socket.on('location_update') 
// a fetch(/api/locations) cada 2-3 seg
// Opcional: WebSocket para notificaciones (no para tracking)
```

---

## Fases de Implementación

### FASE 1: Crear endpoint batch + state detection
- [ ] `POST /api/locations/batch` con validación Kalman
- [ ] LocationStateManager en Redis
- [ ] Endpoint `GET /api/locations/self`

### FASE 2: Reemplazar Socket en APP
- [ ] Crear `PollingTrackingService` en Flutter
- [ ] Timer cada 5 seg (adaptativo según batería)
- [ ] Buffer local para offline

### FASE 3: Admin Panel sin Socket (opcional)
- [ ] Cambiar a fetch HTTP (más robusto)
- [ ] Mantener Redis pub/sub para notificaciones urgentes

### FASE 4: Testing
- [ ] Simular 3G + latencia
- [ ] Verificar recorridos suave
- [ ] Medir consumo de batería

---

## Configuración por Estado

```javascript
const POLLING_CONFIG = {
  STOPPED: { interval: 60000, gpsAccurate: false },      // 1 min
  DEEP_SLEEP: { interval: 30000, gpsAccurate: false },   // 30 seg
  WALKING: { interval: 5000, gpsAccurate: true },        // 5 seg
  DRIVING: { interval: 3000, gpsAccurate: true },        // 3 seg
  OFFLINE: { interval: 10000, gpsAccurate: true },       // 10 seg (retry)
  PAUSED: { interval: 30000, gpsAccurate: false }        // 30 seg (check commands)
}
```

---

## Ejemplo de Flujo

### 1. APP envía ubicación
```
POST /api/locations/batch
{
  "latitude": -12.045,
  "longitude": -77.029,
  "accuracy": 15,
  "speed": 5.2,
  "activity": "DRIVING",
  "timestamp": 1711270800000,
  "batteryLevel": 65,
  "state": "DRIVING"
}
```

### 2. Servidor procesa
```
- Valida con Kalman Filter
- Detecta: "usuario en ruta actual, velocidad normal"
- Calcula ETA con OSRM
- Guarda en DB + Redis
- Responde:
```

### 3. Servidor responde
```json
{
  "state": "DRIVING",
  "routeId": "route_123",
  "eta": 1200,
  "confidence": 0.95,
  "polyline": "encoded_route",
  "nextWaypoint": {...}
}
```

### 4. APP ajusta polling
```
- Si DRIVING → polling cada 3 seg
- Si WALKING → polling cada 5 seg
- Si STOPPED → polling cada 60 seg
```

### 5. Admin Panel
```
- Pulea /api/locations cada 2 seg
- Recibe estado pre-calculado
- Dibuja ruta + ETA sin delays
```

---

## Beneficios Finales

✅ **Sin Socket** = Menos crashes  
✅ **HTTP REST** = Funciona en cualquier red  
✅ **State-driven** = Decisiones claras  
✅ **Recorridos suave** = ETA pre-calculada en servidor  
✅ **Menor latencia de datos** = Admin ve datos frescos cada 2 seg  
✅ **Mejor batería** = Polling adaptativo  

---

## Compatibilidad con IA (Futuro)

Con este sistema es MÁS fácil agregar:
- Predicción de ruta con ML (usar histórico de estados)
- Detección de anomalías (geofences)
- ETA inteligente (sin Google API)
- Recomendaciones de ruta (basadas en histórico)

