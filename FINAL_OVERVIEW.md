# GPS Tracking System - Full Component Overview

### 1. Database (PostgreSQL + PostGIS)
- **File**: `database/init.sql`
- **Purpose**: Stores employees, active trips, raw location points with geography types, and detected stops.
- **Index**: Spatial GIST index for fast coordinate querying.

### 2. Backend API (Node.js/Express)
- **File**: `api/src/server.js`
- **Auth**: JWT-based (7 days expiration).
- **Real-time**: Socket.IO for broadcasting `location_update` events to admins.
- **Ingestion**: `/api/locations/batch` for high-throughput data uploading.

### 3. Worker Service (Node.js/BullMQ)
- **File**: `worker/src/worker.js`
- **Trip Logic**: Automatically links points to trips; calculates total distance using PostGIS.
- **Stop Detection**: Identifies idle periods (< 1km/h for 5min) and records them as stops.

### 4. Admin Panel (React/Vite/Leaflet)
- **File**: `admin-panel/src/pages/Dashboard.jsx`
- **Live View**: Real-time marker movements for all active vendors.
- **History**: Date/User filters to replay routes and visualize stops.
- **Credentials**: `admin@tracking.com` / `admin123`

### 5. Flutter Mobile App (Android)
- **File**: `mobile/flutter_app/lib/main.dart`
- **Background**: Uses `flutter_background_service` for persistent tracking.
- **Battery**: Batched uploads every 30s.
- **Credentials**: `john@tracking.com` / `vendor123`

### 6. Orchestration (Docker Compose)
- **File**: `docker-compose.yml`
- **Servicios**: `postgres`, `redis`, `api`, `worker`, `admin-panel`.
- **Command**: `docker-compose up -d --build`
