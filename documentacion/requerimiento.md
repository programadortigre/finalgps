# PROMPT FINAL — SISTEMA PROFESIONAL DE TRACKING GPS PARA VENDEDORES

Quiero que generes **un sistema completo de tracking GPS para vendedores en campo**, optimizado para **bajo consumo de batería**, **historial de rutas**, **detección de paradas**, **realtime tracking** y **panel administrativo profesional**.

El sistema debe estar **bien estructurado, dockerizado, documentado y listo para producción**.

---

# 1. OBJETIVO DEL SISTEMA

Este sistema se usará para **monitorear vendedores en campo**.

Debe permitir:

### Para el vendedor (app Android)

* Login seguro
* Obtener ubicación GPS
* Enviar ubicaciones al servidor
* Funcionar **en segundo plano incluso si la app se cierra**
* Bajo consumo de batería
* Enviar ubicaciones en **batch**
* Ver su propio recorrido en el mapa

### Para el administrador

* Ver vendedores **en tiempo real**
* Ver **historial de rutas por día**
* Ver **distancia recorrida**
* Ver **paradas**
* Reproducir rutas (playback)
* Ver todo en un **mapa interactivo**

---

# 2. STACK TECNOLÓGICO

### Mobile App

Flutter (solo Android)

Plugins:

* geolocator
* flutter_background_service
* flutter_secure_storage
* dio
* socket_io_client
* google_maps_flutter

---

### Backend

Node.js 20
Framework: Express

Realtime:

Socket.IO

---

### Queue / procesamiento

BullMQ

---

### Cache / broker

Redis

---

### Base de datos

PostgreSQL + PostGIS

---

### Panel admin

React + Vite

Mapa:

Leaflet

---

### Infraestructura

Docker
Docker Compose

---

# 3. ARQUITECTURA

Arquitectura basada en eventos.

Flujo:

APP FLUTTER
→ envía batch de ubicaciones
→ API Node.js
→ cola Redis (BullMQ)
→ Worker procesa
→ guarda en PostgreSQL
→ emite evento realtime
→ panel admin recibe actualización

Esto evita sobrecargar la API.

---

# 4. ESTRUCTURA DEL PROYECTO

tracking-system/

docker-compose.yml
.env

api/
Dockerfile
package.json
src/
server.js
routes/
auth.js
locations.js
trips.js
middleware/
auth.js
socket/
socket.js
services/
queue.js
db/
postgres.js

worker/
Dockerfile
package.json
src/
worker.js
tripProcessor.js
stopDetector.js

admin-panel/
Dockerfile
package.json
src/
App.jsx
pages/
Login.jsx
Dashboard.jsx
Trips.jsx
components/
MapView.jsx
Playback.jsx

mobile/
flutter_app/

database/
init.sql

---

# 5. BASE DE DATOS

Usar PostgreSQL con extensión PostGIS.

Tablas:

employees

id
name
email
password_hash
role (admin / employee)
created_at

---

trips

id
employee_id
start_time
end_time
distance_meters
created_at

---

locations

id
trip_id
employee_id
geom GEOGRAPHY(Point,4326)
latitude
longitude
speed
accuracy
timestamp

Índices:

employee_id
timestamp

---

stops

id
trip_id
employee_id
latitude
longitude
start_time
end_time
duration_seconds

---

# 6. AUTENTICACIÓN

Usar JWT.

Endpoints:

POST /api/auth/login

Response:

accessToken
refreshToken

Expiración:

accessToken → 7 días

---

POST /api/auth/refresh

Genera nuevo token.

---

Todos los endpoints protegidos deben usar:

Authorization Bearer Token

---

# 7. API ENDPOINTS

POST /api/locations/batch

Recibe múltiples ubicaciones.

Ejemplo:

{
"points":[
{
"lat": -12.0464,
"lng": -77.0428,
"speed": 3,
"accuracy": 5,
"timestamp": 171000000
}
]
}

Validaciones:

* lat entre -90 y 90
* lng entre -180 y 180
* timestamp válido

La API **no guarda directamente**.

Debe enviar los datos a Redis queue.

---

GET /api/trips

Query params:

employeeId
date

Devuelve viajes del día.

---

GET /api/trip/:id

Devuelve:

* datos del viaje
* ruta en GeoJSON
* paradas

---

# 8. WORKER

Worker usando BullMQ.

Funciones:

1. Insertar ubicaciones en PostGIS

2. Crear viajes automáticamente

Si pasan 10 minutos sin ubicaciones
→ cerrar viaje

3. Calcular distancia

Sumar distancia entre puntos consecutivos.

4. Detectar paradas

Condición:

velocidad < 1 km/h
durante más de 5 minutos

Crear registro en tabla stops.

5. Idempotencia

Evitar duplicados usando:

employee_id + timestamp

---

# 9. TIEMPO REAL

Usar Socket.IO.

Evento:

location_update

Payload:

{
employeeId,
lat,
lng,
timestamp
}

Rooms:

admins
employee:{id}

Solo los admins reciben ubicaciones de todos.

---

# 10. PANEL ADMIN

Aplicación React.

Funciones:

Login con JWT.

Dashboard con mapa.

Mostrar vendedores en tiempo real.

Marcadores que se mueven en el mapa.

---

Historial de rutas:

Seleccionar vendedor
Seleccionar fecha

Mostrar ruta en mapa.

---

Playback:

Animar la ruta punto por punto.

---

Mostrar paradas.

---

# 11. APP FLUTTER

Pantallas:

Login
Mapa

---

Guardar token en:

flutter_secure_storage

---

Tracking en background:

Usar:

flutter_background_service
geolocator

---

Configuración GPS:

interval → 15 segundos
distanceFilter → 20 metros

---

Batch upload:

Enviar ubicaciones cada 30 segundos.

---

# 12. PERMISOS ANDROID

En AndroidManifest:

ACCESS_FINE_LOCATION
ACCESS_COARSE_LOCATION
ACCESS_BACKGROUND_LOCATION
FOREGROUND_SERVICE

La app debe seguir enviando ubicación aunque el usuario cierre la app.

---

# 13. DOCKER COMPOSE

Servicios:

postgres
redis
api
worker
admin-panel

Postgres debe incluir PostGIS.

---

# 14. VARIABLES DE ENTORNO

.env

POSTGRES_DB=tracking
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

REDIS_HOST=redis
REDIS_PORT=6379

JWT_SECRET=supersecret

PORT=3000

---

# 15. LOGS

Usar biblioteca pino para logs estructurados.

---

# 16. RETENCIÓN DE DATOS

Eliminar ubicaciones con más de 6 meses usando job programado.

---

# 17. RESULTADO FINAL

El sistema final debe permitir:

✔ vendedores enviando ubicación
✔ tracking en background
✔ bajo consumo de batería
✔ admin viendo vendedores en tiempo real
✔ historial de rutas
✔ detección de paradas
✔ playback de rutas
✔ login seguro
✔ sistema dockerizado
✔ arquitectura escalable

---

# INSTRUCCIÓN FINAL

Genera **todo el código del proyecto completo**, incluyendo:

* backend
* worker
* base de datos
* docker
* panel admin
* app flutter

El código debe ser **limpio, modular, documentado y listo para producción**.