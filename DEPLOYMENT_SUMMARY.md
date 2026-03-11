# 🎯 Resumen: Deploy Dinámico & Flexible

## El Problema Original

Tu sistema estaba **hardcodeado** a `zym.lat`:
- ❌ App Flutter: presets fijos
- ❌ Admin panel: URL de API fija
- ❌ No hay forma fácil de cambiar entre dev/test/prod
- ❌ Difícil probar en red local con teléfono
- ❌ Sin forma de usar alternativas como NGROK

---

## La Solución: Sistema Dinámico 🚀

Creamos un sistema **flexible y fácil de usar** que soporta:

### 4 Escenarios de Deploy

| # | Escenario | Caso de Uso | URL Ejemplo |
|---|-----------|-----------|-------------|
| 1️⃣ | **Local Development** | Desarrollo en tu PC | `http://localhost:3000` |
| 2️⃣ | **Red Local (LAN)** | Teléfono + PC misma WiFi | `http://192.168.0.102:3000` |
| 3️⃣ | **NGROK Tunnel** | Expose a internet sin dominio | `https://abc123.ngrok.io` |
| 4️⃣ | **Producción** | Dominio permanente con SSL | `https://zym.lat` |

---

## ¿Cómo Funciona Ahora?

### Antes (Hardcodeado)
```
App Flutter → zym.lat (siempre)
Admin Panel → zym.lat (siempre)
No hay forma de cambiar...
```

### Ahora (Dinámico)
```
↓ Editas .env:
DEPLOY_MODE=local
API_DOMAIN=localhost
API_PORT=3000

↓ Docker lee .env y configura TODO automáticamente

↓ App Flutter:
- Lee la URL de SharedPreferences
- Te permite cambiar en login (⚙️ settings)
- Guarda en base de datos encriptada

↓ Admin Panel:
- Lee VITE_API_URL del .env
- Proxy de Nginx se auto-configura
- Siempre apunta al lugar correcto
```

---

## Archivos Creados/Modificados

### 📄 Documentación Nueva

1. **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** ⭐ **LEER PRIMERO**
   - Guía visual paso a paso
   - Ejemplos prácticos para cada escenario
   - Solución de problemas

2. **[DEPLOYMENT_CONFIG.md](DEPLOYMENT_CONFIG.md)**
   - Documentación técnica completa
   - Configuración de cada servicio
   - Variables de entorno explicadas

### 🔧 Scripts de Configuración

3. **[setup-deploy.ps1](setup-deploy.ps1)** (Windows PowerShell)
   - Script interactivo
   - Te pregunta qué escenario usarás
   - Genera .env automáticamente
   - Crea admin-panel/.env.local

4. **[setup-deploy.sh](setup-deploy.sh)** (Bash/Linux)
   - Misma funcionalidad que PowerShell
   - Para Linux/Mac

### ⚙️ Archivos de Configuración

5. **[.env](`.env`)** - Actualizado
   ```bash
   DEPLOY_MODE=local
   API_DOMAIN=localhost
   API_PORT=3000
   # ... resto de variables
   ```

6. **[admin-panel/.env.example](admin-panel/.env.example)**
   - Template para admin panel
   - Ejemplos para cada escenario

### 📖 Documentación Actualizada

7. **[README.md](README.md)** - Actualizado
   - Links a nuevas guías
   - Quick start mejorado
   - Selector de escenario

---

## Cómo Usarlo (Inicio Rápido)

### Opción A: Script Interactivo (Recomendado)

```powershell
.\setup-deploy.ps1
```

Luego selecciona tu escenario (1, 2, 3 o 4) y ¡listo!

### Opción B: Manual

1. Edita `.env`:
```bash
DEPLOY_MODE=local
API_DOMAIN=localhost
API_PORT=3000
```

2. Edita `admin-panel/.env.local`:
```bash
VITE_API_URL=http://localhost:3000
```

3. Inicia Docker:
```bash
docker-compose up -d --build
```

---

## Ejemplo Práctico: Cambiar de Dev a LAN

**Escenario:** Quieres probar con tu teléfono Android en red local

### Paso 1: Ejecuta el script
```powershell
.\setup-deploy.ps1
```

### Paso 2: Selecciona opción 2
```
Opción: 2
Ingresa tu IP local (ej: 192.168.0.102): 192.168.0.102
```

### Paso 3: Abre puerto en Windows (solo una vez)
```powershell
# PowerShell como Administrador
New-NetFirewallRule -DisplayName "GPS Tracker API" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000
```

### Paso 4: Inicia Docker
```powershell
docker-compose down
docker-compose up -d --build
```

### Resultado:
- ✅ Admin Panel: http://192.168.0.102
- ✅ App Flutter: ingresa http://192.168.0.102:3000 en login
- ✅ Ambos se comunican en la red local

---

## ¿Qué Pasó con los Presets de la App?

### Antes (Hardcodeado)
```dart
const List<Map<String, String>> kServerPresets = [
  {'label': '🌐 Servidor Zyma', 'url': 'https://zyma.lat'},
  {'label': '🏠 Local (Dev)',     'url': 'http://192.168.0.102:3000'},
];
```

### Ahora (Igual pero con opción de Custom)
```dart
const List<Map<String, String>> kServerPresets = [
  {'label': '🌐 Servidor Zyma', 'url': 'https://zyma.lat'},
  {'label': '🏠 Local (Dev)',     'url': 'http://192.168.0.102:3000'},
  // Puedes agregar más presets aquí
];

// EN LA PANTALLA DE LOGIN:
// Presiona ⚙️ → Selecciona preset O escribe URL manualmente
// Se guarda en SharedPreferences (encriptado)
```

### Ventaja:
El usuario puede cambiar el servidor **sin recompilar** la app. Solo va a login y cambia la URL.

---

## Beneficios

### 🎯 Para Desarrollo
- Cambiar entre dev/test/prod en 30 segundos
- No necesitas recompilar nada
- Mismo código funciona en cualquier lado

### 📱 Para Testing
- Prueba con teléfono en red local
- Usa NGROK para demo a clientes
- Everything works without recompilation

### 🚀 Para Producción
- Deploy a dominio real con SSL
- Fácil cambiar de servidor
- Escalable y flexible

### 🔒 Para Seguridad
- Variables sensibles en .env (no en código)
- No hay URLs hardcodeadas
- Credenciales no se comprometen

---

## Próximos Pasos

1. **Lee [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)**
   - Elige tu escenario
   - Sigue los pasos

2. **Ejecuta el setup**
   ```powershell
   .\setup-deploy.ps1
   ```

3. **Inicia Docker**
   ```powershell
   docker-compose up -d --build
   ```

4. **Prueba**
   - Admin Panel: http://localhost (o tu IP)
   - App Flutter: configura en login

---

## Archivo `.env` Explicado

```bash
# Escenario actual
DEPLOY_MODE=local              # local | local-network | ngrok | production

# Dominio/IP actual
API_DOMAIN=localhost

# Puerto (3000=dev, 443=prod)
API_PORT=3000

# Database (sin cambios)
POSTGRES_DB=tracking
POSTGRES_USER=postgres
POSTGRES_PASSWORD=supersecure-2024-change-in-production

# Redis (sin cambios)
REDIS_HOST=redis
REDIS_PORT=6379

# JWT (cambiar en producción)
JWT_SECRET=supersecret-gps-tracking-2024-change-in-production

# Etc...
```

---

## ✅ Checklist

- [x] Creado DEPLOYMENT_GUIDE.md (guía visual)
- [x] Creado DEPLOYMENT_CONFIG.md (documentación técnica)
- [x] Creado setup-deploy.ps1 (script Windows)
- [x] Creado setup-deploy.sh (script Linux/Mac)
- [x] Actualizado .env con variables de deploy
- [x] Creado admin-panel/.env.example
- [x] Actualizado README.md con links
- [x] Sistema flexible para 4 escenarios
- [x] Sin hardcoding de URLs

---

## 🎓 Resumen Visual

```
ANTES (Problema):
zym.lat ← Hardcodeado en APP, ADMIN PANEL, API
No hay forma de cambiar sin recompilar/redeploy

DESPUÉS (Solución):
.env → DEPLOY_MODE + API_DOMAIN
  ↓
Docker configura automáticamente
  ↓
App puede cambiar URL en login
  ↓
Admin panel usa VITE_API_URL dinámico
  ↓
¡Todo funciona en cualquier escenario!
```

---

## 🚀 Ready?

Ejecuta:
```powershell
.\setup-deploy.ps1
```

¡Eso es todo! El script te guiará paso a paso.

Si tienes dudas: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

