# 🚀 Guía de Configuración de Deploy

Este documento explica cómo configurar el sistema GPS Tracker para diferentes escenarios de despliegue.

---

## 📋 Scenarios Soportados

### 1. **Desarrollo Local (Dev Environment)**
- **Uso**: Desarrollo en tu máquina local
- **URL API**: `http://localhost:3000`
- **Admin Panel**: `http://localhost:80`
- **App**: Cambiará dinámicamente en login
- **Requisitos**: Docker Desktop running

```bash
# Configurar .env
API_DOMAIN=localhost
API_PORT=3000
DEPLOY_MODE=local
```

---

### 2. **Red Local IP (LAN - Same WiFi)**
- **Uso**: Probar con teléfono Android en la misma red
- **URL API**: `http://192.168.0.102:3000` (tu IP local)
- **Admin Panel**: `http://192.168.0.102:80`
- **App**: Se configura en login screen
- **Requisitos**: 
  - PC y teléfono en misma red WiFi
  - Puerto 3000 abierto en firewall Windows

```bash
# Configurar .env
API_DOMAIN=192.168.0.102
API_PORT=3000
DEPLOY_MODE=local-network
```

**⚠️ Para abrir puerto en Windows:**
```powershell
# Abrir puerto 3000 en Windows Defender Firewall
New-NetFirewallRule -DisplayName "GPS Tracker API" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000
```

---

### 3. **Cloudflare Tunnel (Producción en VM)**
- **Uso**: Exponer máquina virtual a internet de forma segura
- **URL API**: `https://tudominio.com` (tu dominio)
- **Admin Panel**: `https://tudominio.com` (mismo dominio)
- **App**: Configurada para usar dominio
- **Ventajas**: 
  - ✅ No expone tu IP pública
  - ✅ No necesitas abrir puertos
  - ✅ Gratuito
  - ✅ SSL/TLS automático
  - ✅ Mejor seguridad que NGROK
  - ✅ Perfecto para VMs
  - ✅ URL permanente (no cambia)

**Pasos:**

1. **Compra un dominio**
   - GoDaddy, Namecheap, etc.
   - Ejemplo: `miempresa.com`

2. **Crea cuenta en Cloudflare**
   - Dirígete a [cloudflare.com](https://cloudflare.com)
   - Crea cuenta gratuita

3. **Agrega tu dominio a Cloudflare**
   - En Cloudflare dashboard → Add site
   - Sigue las instrucciones para cambiar nameservers
   - Espera propagación DNS (puede tomar 24h)

4. **Instala Cloudflare CLI (`warp`)**

   **Windows:**
   ```powershell
   # Descarga desde: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
   # O instala con chocolatey:
   choco install cloudflare-warp
   ```

   **Verifica instalación:**
   ```powershell
   warp-cli --version
   ```

5. **Autentica tu máquina**
   ```powershell
   warp-cli login
   ```
   Se abrirá navegador para autenticar

6. **Crea el túnel**
   ```powershell
   warp-cli tunnel create gps-tracker
   ```
   Copiarás un token como: `ey...`

7. **Crea archivo de configuración** (`~/.warp/config.toml`)

   **Windows** - Crea en `C:\Users\tu-usuario\.warp\config.toml`:
   ```toml
   [service]
   # Token que obtuviste en warp-cli tunnel create
   token = "ey..." 

   [ingress]
   # Apunta a tu contenedor Docker
   service = "http://localhost:3000"

   # Captura: http://localhost:3000 → https://tudominio.com
   ```

8. **Conecta el túnel al dominio**
   ```powershell
   warp-cli tunnel route add tudominio.com
   ```

9. **Inicia el túnel**
   ```powershell
   warp-cli tunnel run
   ```

   Deberías ver:
   ```
   2026-03-11T12:34:56Z INF Tunnel is ready to accept traffic
   ```

10. **Configurar en .env:**
    ```bash
    API_DOMAIN=tudominio.com
    API_PORT=443
    DEPLOY_MODE=production
    ```

11. **Inicia Docker**
    ```powershell
    docker-compose up -d --build
    ```

12. **Verifica que funciona**
    - Admin Panel: https://tudominio.com
    - API: https://tudominio.com/api

**Ventajas vs alternativas:**
- vs NGROK: URL permanente, mejor seguridad, no expone IP
- vs servidor dedicado: No necesitas abrir puertos, SSL gratis, más seguro
- vs máquina virtual pública: Tu IP nunca se ve, DDoS protection incluido

---

### 4. **Túnel con NGROK (Testing Temporal)**
- **Uso**: Testing rápido sin configurar dominio
- **URL API**: `https://abc123.ngrok.io` (generada por ngrok)
- **Admin Panel**: `https://abc123.ngrok.io` (mismo túnel)
- **App**: Se configura en login screen
- **Ventajas**: 
  - Muy fácil de configurar
  - Testing rápido
  - Funciona con mobile
- **Desventajas**:
  - URL cambia cada restart
  - Expone tu máquina a internet
  - Limitaciones en plan free

**Pasos:**

1. **Descargar ngrok** desde [ngrok.com](https://ngrok.com)

2. **Autenticar ngrok:**
```bash
ngrok config add-authtoken <tu-token>
```

3. **Iniciar túnel:**
```bash
ngrok http 3000
```

4. **Copiar URL** (ej: `https://abc123.ngrok.io`)

5. **Configurar en .env:**
```bash
API_DOMAIN=abc123.ngrok.io
API_PORT=443
DEPLOY_MODE=ngrok
```

6. **En app Flutter**: Usa el preset o escribe la URL manualmente en login

⚠️ **Nota**: La URL cambia cada vez que reinicia ngrok. Debes actualizar .env.

---

### 5. **Producción con IP Estática (Servidor Dedicado)**
API_PORT=443
DEPLOY_MODE=production
```

---

## 🔧 Configuración de .env

Crea/actualiza tu archivo `.env` en la raíz del proyecto:

```bash
# ============================================================================
# DEPLOY CONFIGURATION
# ============================================================================
# Opciones: local | local-network | ngrok | production
DEPLOY_MODE=local

# Tu dominio/IP/túnel (sin http/https)
# Ejemplos:
#   - localhost (dev)
#   - 192.168.0.102 (red local)
#   - abc123.ngrok.io (túnel)
#   - api.tudominio.com (producción)
API_DOMAIN=localhost

# Puerto de la API
# 3000 = desarrollo
# 443 = producción (HTTPS)
API_PORT=3000

# ============================================================================
# DATABASE
# ============================================================================
POSTGRES_DB=tracking
POSTGRES_USER=postgres
POSTGRES_PASSWORD=supersecure-2024
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

# ============================================================================
# CACHE / MESSAGE BROKER
# ============================================================================
REDIS_HOST=redis
REDIS_PORT=6379

# ============================================================================
# AUTHENTICATION
# ============================================================================
JWT_SECRET=supersecret-gps-tracking-2024
JWT_EXPIRATION=7d

# ============================================================================
# SERVER PORTS (Docker internal)
# ============================================================================
API_PORT=3000
NODE_ENV=development

# ============================================================================
# Optional: Para HTTPS en producción
# ============================================================================
# CERT_PATH=/etc/letsencrypt/live/api.tudominio.com/fullchain.pem
# KEY_PATH=/etc/letsencrypt/live/api.tudominio.com/privkey.pem
```

---

## 📱 Configuración en App Flutter

La app Flutter tiene un **selector dinámico de servidor** en la pantalla de login:

### Flujo:
1. En login, presiona el ícono de servidor ⚙️
2. Elige un preset O escribe URL manualmente
3. La URL se guarda en `SharedPreferences` (encriptada)
4. La app usa esa URL para todas las conexiones

### Presets Incluidos:
```dart
const List<Map<String, String>> kServerPresets = [
  {'label': '🌐 Servidor Zyma', 'url': 'https://zyma.lat'},
  {'label': '🏠 Local (Dev)',     'url': 'http://192.168.0.102:3000'},
];
```

### Para Agregar Nuevos Presets:
Edita `mobile/flutter_app/lib/services/api_service.dart`:

```dart
const List<Map<String, String>> kServerPresets = [
  {'label': '🌐 Servidor Zyma', 'url': 'https://zyma.lat'},
  {'label': '🏠 Local (Dev)',     'url': 'http://192.168.0.102:3000'},
  {'label': '🔗 Túnel NGROK',     'url': 'https://abc123.ngrok.io'},  // NUEVO
  {'label': '☁️ Producción',       'url': 'https://gps.empresa.com'},  // NUEVO
];
```

---

## 🌐 Configuración en Admin Panel

El admin panel usa variables de entorno de Vite (`.env.local`):

```bash
# admin-panel/.env.local

# Para desarrollo local
VITE_API_URL=http://localhost:3000

# Para red local
VITE_API_URL=http://192.168.0.102:3000

# Para ngrok
VITE_API_URL=https://abc123.ngrok.io

# Para producción
VITE_API_URL=https://api.zym.lat
```

### Diferente por entorno:

```bash
# .env.development
VITE_API_URL=http://localhost:3000

# .env.local (tu máquina)
VITE_API_URL=http://192.168.0.102:3000

# .env.production
VITE_API_URL=https://zym.lat
```

---

## 🐳 Configuración en Docker

### Docker Compose

El `docker-compose.yml` está configurado para obtener valores del `.env` principal:

```yaml
environment:
  - API_DOMAIN=${API_DOMAIN}
  - API_PORT=${API_PORT}
  - DEPLOY_MODE=${DEPLOY_MODE}
```

### Nginx (Admin Panel)

Los proxies en `admin-panel/nginx.conf` se actualizan automáticamente basado en `API_DOMAIN`.

---

## 📊 Tabla de Configuración Rápida

| Escenario | `DEPLOY_MODE` | `API_DOMAIN` | `API_PORT` | URL Resultado |
|-----------|---------------|------------|-----------|---------------|
| Dev | `local` | `localhost` | `3000` | `http://localhost:3000` |
| LAN | `local-network` | `192.168.0.102` | `3000` | `http://192.168.0.102:3000` |
| NGROK | `ngrok` | `abc123.ngrok.io` | `443` | `https://abc123.ngrok.io` |
| Prod | `production` | `zym.lat` | `443` | `https://zym.lat` |

---

## 🚀 Scripts de Deploy

### 1. Deploy Rápido Local
```bash
# Editar .env
DEPLOY_MODE=local
API_DOMAIN=localhost
API_PORT=3000

# Buildear
docker-compose up -d --build

# Acceder: http://localhost
```

### 2. Deploy en Red Local
```bash
# Ver tu IP
ipconfig

# Editar .env
DEPLOY_MODE=local-network
API_DOMAIN=192.168.0.102
API_PORT=3000

# Buildear
docker-compose up -d --build

# Admin: http://192.168.0.102
# App: Ingresar URL en login
```

### 3. Deploy con NGROK
```bash
# Iniciar ngrok en otra terminal
ngrok http 3000

# Copiar URL: https://abc123.ngrok.io

# Editar .env
DEPLOY_MODE=ngrok
API_DOMAIN=abc123.ngrok.io
API_PORT=443

# Buildear es opcional (internamente sigue siendo 3000)
docker-compose up -d --build

# Admin: https://abc123.ngrok.io
# App: Ingresar https://abc123.ngrok.io en login
```

### 4. Deploy en Producción
```bash
# Editar .env
DEPLOY_MODE=production
API_DOMAIN=zym.lat
API_PORT=443

# Con SSL (opcional con Let's Encrypt)
CERT_PATH=/etc/letsencrypt/live/zym.lat/fullchain.pem
KEY_PATH=/etc/letsencrypt/live/zym.lat/privkey.pem

# Buildear
docker-compose up -d --build

# Admin: https://zym.lat
# App: https://zym.lat (preseleccionado)
```

---

## ✅ Checklist de Configuración

Antes de deployar:

- [ ] Edité `.env` con `DEPLOY_MODE` correcto
- [ ] Configuré `API_DOMAIN` correctamente
- [ ] Configuré `API_PORT` (3000 para dev, 443 para prod)
- [ ] Si uso ngrok: está ejecutándose y copié la URL
- [ ] Si es red local: mi IP es correcta y puerto 3000 abierto
- [ ] Ejecuté `docker-compose up -d --build`
- [ ] Verificué que los contenedores están corriendo: `docker-compose ps`
- [ ] Testeé la conexión desde navegador
- [ ] En app Flutter: ingresé la URL correcta en login

---

## 🐛 Troubleshooting

### "Connection refused" en app Flutter
- Verifica que `API_DOMAIN` y `API_PORT` sean correctos
- Si es red local: confirma IP con `ipconfig`
- Si es ngrok: cdqverifica que ngrok siga ejecutándose

### Admin panel no carga datos
- Abre DevTools (F12) → Console
- Verifica requests en Network tab
- Confirma que VITE_API_URL sea correcto

### Socket.IO no conecta
- El socket usa la misma URL que el API
- En admin panel: verifica `VITE_API_URL`
- En app: verifica la URL configurada en login

### Nginx error "502 Bad Gateway"
- Verifica que `api:3000` esté disponible: `docker-compose ps`
- Reinicia nginx: `docker restart gps-admin`

---

## 📚 Referencias

- [NGROK Documentation](https://ngrok.com/docs)
- [Let's Encrypt](https://letsencrypt.org/)
- [Docker Compose](https://docs.docker.com/compose/)

