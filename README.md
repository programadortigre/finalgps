# Setup & Installation Guide

## 1. Prerequisites
- Docker & Docker Compose
- Flutter SDK (for mobile app)
- Android Emulator or physical device

## 2. Infrastructure Setup (Docker)
In the root directory, run:
```bash
docker-compose up -d --build
```
This will start:
- **PostgreSQL**: http://localhost:5432
- **Redis**: http://localhost:6379
- **API**: http://localhost:3000
- **Admin Panel**: http://localhost:80

## 3. Admin Panel Access
1. Open http://localhost in your browser.
2. Login credentials:
   - **Email**: `admin@tracking.com`
   - **Password**: `admin123`

## 4. Mobile App Setup
1. Navigate to `mobile/flutter_app`.
2. Get dependencies:
   ```bash
   flutter pub get
   ```
3. Run on Android Emulator:
   ```bash
   flutter run
   ```
4. Mobile credentials:
   - **Email**: `john@tracking.com`
   - **Password**: `vendor123`

> [!NOTE]
> When running on an emulator, the API URL is set to `http://10.0.2.2:3000`. For physical devices, change this to your computer's local IP address in `lib/services/api_service.dart`.

## 5. System Features
- **Background Tracking**: The app uses `flutter_background_service` to persist tracking even when the app is minimized or closed.
- **Batching**: Points are collected and sent every 30 seconds to save battery.
- **Worker Logic**: The worker automatically groups points into trips and identifies stops if speed is < 1 km/h for more than 5 minutes.
- **Real-time**: Admins can see live updates as soon as points hit the API via Socket.IO.
