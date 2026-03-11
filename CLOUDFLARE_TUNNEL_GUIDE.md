# 🚀 Cloudflare Tunnel - Guía Completa

Esta es la **mejor opción para tu máquina virtual** con dominio propio.

---

## ¿Por Qué Cloudflare Tunnel?

### Comparativa

| Feature | Cloudflare Tunnel | NGROK | IP Estática |
|---------|-------------------|-------|------------|
| **URL Permanente** | ✅ | ❌ Cambia cada restart | ✅ |
| **Expone tu IP** | ❌ | ⚠️ Sí | ⚠️ Sí |
| **Abrir Puertos** | ❌ | ❌ | ⚠️ Sí |
| **SSL Automático** | ✅ | ✅ | ⚠️ Necesita Let's Encrypt |
| **DDoS Protection** | ✅ | ❌ | ❌ |
| **Costo** | Gratis | Gratis (limitado) | $$ servidor |
| **Complejidad** | Fácil | Muy fácil | Media |

### Tu Caso:
✅ VM Sin IP pública → **Cloudflare Tunnel es perfecto**
✅ Quieres URL permanente → **Cloudflare Tunnel**
✅ Tienes dominio → **Cloudflare Tunnel**
✅ Quieres máxima seguridad → **Cloudflare Tunnel**

---

## 📋 Requisitos

- ✅ Dominio adquirido (godaddy.com, namecheap.com, etc)
- ✅ Cuenta Cloudflare gratuita
- ✅ Docker corriendo en tu VM
- ✅ 5 minutos de tiempo

---

## 🔧 Setup Paso a Paso

### PASO 1: Comprar Dominio

Proveedores:
- [GoDaddy](https://godaddy.com) - Popular
- [Namecheap](https://namecheap.com) - Barato
- [HostGator](https://hostgator.com) - Con hosting incluido
- O cualquier otro registrar

**Para este ejemplo usaremos:** `miempresa.com`

**Costo:** ~$10-15/año

---

### PASO 2: Crear Cuenta Cloudflare

1. Ve a [cloudflare.com](https://www.cloudflare.com)
2. Click "Sign Up"
3. Usa email y contraseña
4. Completa verificación de email

**Es GRATIS.** Plan free incluye:
- ✅ Túnel ilimitado
- ✅ SSL automático
- ✅ DDoS protection
- ✅ Ataque protection

---

### PASO 3: Agregar tu Dominio a Cloudflare

#### En Cloudflare Dashboard:

1. Click **"Add a site"**
2. Ingresa tu dominio: `miempresa.com` → **Continue**
3. Selecciona plan **FREE** → **Continue**
4. Cloudflare te mostrará dos **nameservers**:
   ```
   ns1234.ns.cloudflare.com
   ns5678.ns.cloudflare.com
   ```

#### En GoDaddy (o tu registrador):

1. Inicia sesión en GoDaddy
2. Ve a **My Products → Domains**
3. Haz click en tu dominio
4. Haz click en **"Nameservers"** (o DNS)
5. Reemplaza los nameservers con los de Cloudflare
6. Guarda cambios

**Espera propagación DNS:** Puede tomar ~24 horas (usualmente 10 minutos)

---

### PASO 4: Instalar Cloudflare WARP CLI

#### En Windows:

**Opción A: Descarga directa**
```powershell
# Ve a: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
# Descarga: cloudflare-warp-client-windows-beta.exe
# Ejecuta y instala normalmente
```

**Opción B: Avec package manager**
```powershell
choco install cloudflare-warp
```

**Verifica instalación:**
```powershell
warp-cli --version
```

Deberá mostrar algo como: `2024.1.0`

---

### PASO 5: Autenticar WARP CLI

```powershell
warp-cli login
```

Se abrirá tu navegador. Autoriza el acceso. Una vez hecho, regresa a PowerShell.

Deberás ver:
```
Successfully logged in.
```

---

### PASO 6: Crear el Túnel

```powershell
warp-cli tunnel create gps-tracker
```

Output esperado:
```
Tunnel ID: 01234567-89ab-cdef-0123-456789abcdde
Token: ey...
```

**GUARDA el Token.** Lo necesitarás en el siguiente paso.

---

### PASO 7: Configurar el Túnel

#### Encontrar la carpeta de configuración:

```powershell
# Normalmente en:
# C:\Users\tu-usuario\.warp\

# Si no existe, créala:
New-Item -Type Directory -Path "$env:USERPROFILE\.warp"
```

#### Crear archivo `config.toml`:

Abre Notepad y crea: `C:\Users\tu-usuario\.warp\config.toml`

Contenido:

```toml
[service]
# Este es el token de tu túnel
token = "ey..."  # Reemplaza con tu token

[ingress]
# URL que apunta a Docker
service = "http://localhost:3000"

# Match: cualquier traffic a tu dominio
# Lo envía a http://localhost:3000
# Cloudflare maneja SSL automáticamente
```

**Reemplaza `ey...` con tu token real.**

#### Guardar:
- Click **File → Save As**
- Tipo: **All Files**
- Nombre: `config.toml`
- Ubicación: `C:\Users\tu-usuario\.warp\`

---

### PASO 8: Conectar el Túnel al Dominio

```powershell
warp-cli tunnel route add miempresa.com
```

Si todo funcionó correctamente:
```
Added traffic routing for miempresa.com to tunnel <id>
```

---

### PASO 9: Iniciar el Túnel

```powershell
warp-cli tunnel run
```

Deberías ver:

```
You can now access your application at https://miempresa.com

Tunnel is ready to accept traffic
```

**¡Déjalo ejecutándose!** Este proceso debe estar corriendo continuamente.

---

### PASO 10: Configurar .env en GPS Tracker

```bash
DEPLOY_MODE=production
API_DOMAIN=miempresa.com
API_PORT=443
```

---

### PASO 11: Reiniciar Docker

```powershell
docker-compose down
docker-compose up -d --build
```

---

### PASO 12: Verificar que Funciona

#### Admin Panel:
```
https://miempresa.com
```

#### API Directa:
```
https://miempresa.com/api/health
```

Deberá retornar:
```json
{
  "status": "OK",
  "timestamp": "2026-03-11T12:34:56.000Z"
}
```

#### App Flutter:
1. En pantalla de login
2. Presiona ⚙️ (settings)
3. Select **"Custom"**
4. Ingresa: `https://miempresa.com`
5. Click **Save**

---

## 🔄 Operación Día a Día

### Si Docker se reinicia:
```powershell
# El túnel sigue funcionando
# Solo reinicia Docker
docker-compose up -d
```

### Si quieres detener todo:
```powershell
# En PowerShell (donde está ejecutándose warp-cli tunnel run):
Ctrl + C

# En otra PowerShell:
docker-compose down
```

### Para volver a iniciar:
```powershell
# Ventana 1: Iniciar Docker
docker-compose up -d --build

# Ventana 2: Iniciar túnel
warp-cli tunnel run
```

---

## 🚀 Script Automatizado (Opcional)

Si quieres iniciar todo con un click, crea `start-production.ps1`:

```powershell
# ============================================================================
# START PRODUCTION WITH CLOUDFLARE TUNNEL
# ============================================================================

Write-Host "🚀 Iniciando GPS Tracker en Producción" -ForegroundColor Green
Write-Host ""

# 1. Docker
Write-Host "📦 Iniciando Docker..." -ForegroundColor Cyan
docker-compose up -d --build

# 2. Cloudflare Tunnel
Write-Host "🔗 Iniciando Cloudflare Tunnel..." -ForegroundColor Cyan
Write-Host ""
warp-cli tunnel run
```

Uso:
```powershell
.\start-production.ps1
```

---

## 🐛 Troubleshooting

### "Connection refused"

```powershell
# Verifica que Docker esté corriendo:
docker-compose ps
```

Si algún contenedor está apagado:
```powershell
docker-compose up -d
```

### "Tunnel refused to connect"

```powershell
# Verifica que warp-cli esté logeado:
warp-cli account

# Si no está logeado:
warp-cli login
```

### "DNS not resolving"

- Espera propagación DNS (puede tomar 24 horas)
- Verifica en: https://www.whatsmydns.net/
- Busca tu dominio y verifica que apunte a Cloudflare

### Admin Panel carga pero sin datos

Abre DevTools (F12) → Console

Si ves CORS error:
```
Access to XMLHttpRequest has been blocked by CORS policy
```

Verifica que `VITE_API_URL` en `admin-panel/.env.local` sea:
```bash
VITE_API_URL=https://miempresa.com
```

### App Flutter no conecta

En login:
1. Presiona ⚙️
2. Verifica que la URL sea: `https://miempresa.com`
3. No `http://` (sin S)
4. Sin `:3000` al final

---

## 📊 Diagrama de Flujo

```
┌─────────────────────────────────────────┐
│     USUARIO EN INTERNET                 │
│  (App, Admin Panel, Navegador)          │
└────────────────┬────────────────────────┘
                 │
                 │ HTTPS
                 │
            ┌────▼────────────────────┐
            │  CLOUDFLARE TUNNEL      │
            │  (SSL, DDoS, Cache)     │
            │  miempresa.com          │
            └────┬────────────────────┘
                 │
                 │ HTTPS (Encriptado)
                 │
            ┌────▼──────────────────────────┐
            │  TU VM (Sin IP pública)       │
            │  ├─ Docker Container API     │
            │  ├─ Docker Container Admin   │
            │  ├─ Docker Container DB      │
            │  └─ Docker Container Redis   │
            └───────────────────────────────┘

BENEFICIOS:
✅ Tu VM está completamente protegida
✅ La IP NUNCA se expone
✅ Los puertos NUNCA se abren
✅ Cloudflare maneja DDoS
✅ SSL se renueva automáticamente
```

---

## ✅ Checklist

- [ ] Dominio comprado
- [ ] Cuenta Cloudflare creada
- [ ] Dominio agregado a Cloudflare
- [ ] Nameservers cambiados
- [ ] DNS propagado
- [ ] WARP CLI instalado
- [ ] WARP CLI logeado
- [ ] Túnel creado
- [ ] config.toml configurado
- [ ] Túnel conectado al dominio
- [ ] Túnel ejecutándose (`warp-cli tunnel run`)
- [ ] Docker corriendo
- [ ] Admin panel accesible en HTTPS
- [ ] App Flutter conecta correctamente

---

## 🎓¿Preguntas?

- **¿Cuánto cuesta?** Nada. Cloudflare free incluye todo.
- **¿Se puede resetear la contraseña?** Sí, desde Cloudflare dashboard.
- **¿Qué pasa si hay apagón?** El túnel se reconecta automáticamente.
- **¿Puedo tener múltiples subdominios?** Sí, con wildcard DNS: `*.miempresa.com`
- **¿Máxima velocidad?** Está limitada solo por tu conexión a internet.

---

## 🚀 Ready?

```powershell
# 1. Asegúrate de tener el token del túnel
# 2. Escribe config.toml
# 3. Ejecuta:
warp-cli tunnel run
```

¡Eso es todo! Tu aplicación estará disponible en producción en segundos.

