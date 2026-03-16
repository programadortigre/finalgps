# Setup & Installation Guide

## 🚀 Quick Deploy Selection

**¿Cómo quieres hacer deploy?** Elige tu escenario:

| Escenario | Mejor para | Link |
|-----------|-----------|------|
| 🏠 **Local Development** | Desarrollo en PC | [Ver guía](DEPLOYMENT_GUIDE.md#escenario-1--desarrollo-local) |
| 🖥️ **Red Local (LAN)** | Testing con teléfono Android | [Ver guía](DEPLOYMENT_GUIDE.md#escenario-2--red-local) |
| ☁️ **Cloudflare Tunnel** | **VM sin IP pública + Dominio** ⭐ | [Ver guía](DEPLOYMENT_GUIDE.md#escenario-3--cloudflare-tunnel--recomendado-para-producción) |
| 🔗 **NGROK Tunnel** | Testing remoto temporal | [Ver guía](DEPLOYMENT_GUIDE.md#escenario-4--ngrok-tunnel--testing-remoto-rápido) |
| 🖥️ **IP Estática** | Servidor con IP pública | [Ver guía](DEPLOYMENT_GUIDE.md#escenario-5--producción-con-ip-estática--servidor-con-ip-pública) |

**✨ Para tu máquina virtual sin IP pública, usa CLOUDFLARE TUNNEL (opción 3)**

**Ó ejecuta el asistente interactivo:**
```powershell
.\setup-deploy.ps1    # Windows
bash setup-deploy.sh  # Linux/Mac
```

---

## 1. Prerequisites
- Docker & Docker Compose
- Flutter SDK (for mobile app)
- Android Emulator or physical device
- **IMPORTANT**: [OSRM Map Data for Peru](OSRM_FIX.md) - Run `bash setup-osrm.sh` before deploying

## 2. Quick Start

**Opción A: Asistente interactivo (recomendado)**
```powershell
.\setup-deploy.ps1    # Windows
# Selecciona tu escenario (1-5)
```

```bash
bash setup-deploy.sh   # Linux/Mac
# Selecciona tu escenario (1-5)
```

**Opción B: Local Development manual**

```powershell
# 1. Inicia Docker
docker-compose up -d --build

# 2. Abre en navegador
# http://localhost
```

**Credenciales:**
- Email: `admin@tracking.com`
- Password: `admin123`

---

## 3. Configuración Manual

Si prefieres configurar manualmente, edita `.env`:

```bash
DEPLOY_MODE=local
API_DOMAIN=localhost
API_PORT=3000
```

Luego:
```bash
docker-compose up -d --build
```

Accede a:
- **Admin Panel**: http://localhost
- **API**: http://localhost:3000
- **PostgreSQL**: http://localhost:5432
- **Redis**: http://localhost:6379

## 4. App Flutter Setup
1. Navigate to `mobile/flutter_app`.
2. Get dependencies:
   ```bash
   flutter pub get
   ```
3. Run on Android:
   ```bash
   flutter run
   ```
4. En login, configura tu servidor:
   - Presiona ⚙️ (configuración de servidor)
   - Selecciona preset O ingresa URL manualmente

---

## 📚 Documentación Completa

- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Guía visual paso a paso (recomendada)
- **[CLOUDFLARE_TUNNEL_GUIDE.md](CLOUDFLARE_TUNNEL_GUIDE.md)** - Guía detallada de Cloudflare Tunnel para VM sin IP
- **[DEPLOYMENT_CONFIG.md](DEPLOYMENT_CONFIG.md)** - Documentación técnica detallada
- **[DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md)** - Resumen del sistema de deploy flexible
- **[DEPLOY_TROUBLESHOOTING.md](DEPLOY_TROUBLESHOOTING.md)** - Solución de problemas comunes en VM/Ubuntu

---

## 🆘 Troubleshooting

Si encuentras errores al ejecutar `deploy.sh` en tu VM Ubuntu:

### Error: `#!/bin/bash: not found`
Esto es un problema de saltos de línea (CRLF vs LF).

**Solución:**
```bash
bash fix-deploy.sh
sudo bash deploy.sh
```

Ver detalle en: [DEPLOY_TROUBLESHOOTING.md](DEPLOY_TROUBLESHOOTING.md)

### Error: `containerd.io: Entra en conflicto: containerd`
El repositorio apt oficial de Docker tiene conflictos en Ubuntu noble.

**✅ Ya está arreglado** en el nuevo `deploy.sh` - usa el script oficial de Docker.

---

## 5. System Features
- **Background Tracking**: La app usa `flutter_background_service` para seguir rastreando incluso cuando está minimizada o cerrada.
- **Batching**: Los puntos se recopilan y se envían cada 30 segundos para ahorrar batería.
- **Worker Logic**: El worker agrupa automáticamente puntos en viajes e identifica paradas si velocidad < 1 km/h durante más de 5 minutos.
- **Real-time**: Los admins ven actualizaciones en vivo mediante Socket.IO.
