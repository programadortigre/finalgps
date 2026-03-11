# 📱 Guía Paso a Paso: Configurar Deploy

Esta guía muestra **cómo configurar cada escenario** de forma visual y práctica.

---

## Escenario 1: 🏠 **DESARROLLO LOCAL** (Recomendado para empezar)

### ¿Cuándo usar?
- Mientras desarrollas
- Testeando solo en tu PC
- Sin necesidad de teléfono físico

### Pasos:

#### 1️⃣ Ejecuta el script de configuración

```powershell
.\setup-deploy.ps1
```

Selecciona opción **1** (Local Development)

#### 2️⃣ Verifica el .env

```bash
cat .env
```

Deberá mostrar:
```
DEPLOY_MODE=local
API_DOMAIN=localhost
API_PORT=3000
```

#### 3️⃣ Inicia Docker

```powershell
docker-compose up -d --build
```

#### 4️⃣ Accede al admin panel

Abre navegador: **http://localhost**

#### 5️⃣ Credenciales por defecto

```
Email: admin@gps.com
Password: admin123
```

---

## Escenario 2: 🖥️ **RED LOCAL** (Para teléfono + PC misma WiFi)

### ¿Cuándo usar?
- Testeando con teléfono físico Android
- PC y teléfono en la misma red WiFi
- Sin internet (LAN)

### Pasos:

#### 1️⃣ Averigua tu IP local

Abre PowerShell y ejecuta:

```powershell
ipconfig
```

Busca **"IPv4 Address"** en tu adaptador WiFi. Ejemplo: `192.168.0.102`

#### 2️⃣ Ejecuta el script

```powershell
.\setup-deploy.ps1
```

Selecciona opción **2** e ingresa tu IP: `192.168.0.102`

#### 3️⃣ Abre puerto 3000 (solo necesario una vez)

**⚠️ IMPORTANTE en Windows:**

Abre PowerShell **COMO ADMINISTRADOR** y ejecuta:

```powershell
New-NetFirewallRule -DisplayName "GPS Tracker API" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000
```

Si funciona, deberías ver:
```
Name                  : GPS Tracker API
Enabled               : True
Direction             : Inbound
```

#### 4️⃣ Inicia Docker

```powershell
docker-compose up -d --build
```

#### 5️⃣ Accede desde navegador

Admin Panel: **http://192.168.0.102**

#### 6️⃣ Accede desde App Flutter

En la pantalla de login:
1. Presiona el ícono ⚙️ (configuración)
2. Selecciona **"Custom"**
3. Ingresa: `http://192.168.0.102:3000`
4. Presiona **Guardar**

**Resultado:**
- Admin panel funciona en la red
- App Flutter puede enviar ubicaciones
- Socket.IO recibe actualizaciones en tiempo real

---

## Escenario 3: ☁️ **CLOUDFLARE TUNNEL** (Recomendado para Producción)

### ¿Cuándo usar?
- **Tu máquina virtual sin IP pública** (como tu caso)
- Tienes un dominio propio (o quieres comprar uno)
- Quieres una URL permanente y segura
- Máxima protección sin abrir puertos

### Ventajas:
- ✅ **No expone tu IP**
- ✅ **URL permanente**
- ✅ **SSL automático**
- ✅ **DDoS Protection**
- ✅ **Gratis**
- ✅ **Sin abrir puertos en firewall**

### Pre-requisitos:
- Dominio adquirido (godaddy.com, namecheap.com, etc) ~$10-15/año
- Cuenta Cloudflare gratis (cloudflare.com)
- WARP CLI instalado

### Pasos:

#### 1️⃣ Lee la guía completa

Para una configuración paso a paso detallada, ve a:

📄 **[CLOUDFLARE_TUNNEL_GUIDE.md](CLOUDFLARE_TUNNEL_GUIDE.md)**

Incluye:
- ✅ Cómo comprar dominio
- ✅ Cómo crear cuenta Cloudflare
- ✅ Cómo instalar WARP CLI
- ✅ Cómo configurar el túnel
- ✅ Troubleshooting

#### 2️⃣ Resumen rápido

```
1. Compra dominio: miempresa.com
2. Agrega a Cloudflare dashboard
3. Cambia nameservers en registrador
4. Instala warp-cli
5. Crea túnel: warp-cli tunnel create gps-tracker
6. Configura config.toml en ~/.warp/
7. Ejecuta: warp-cli tunnel run
8. Edita .env con:
   DEPLOY_MODE=production
   API_DOMAIN=miempresa.com
   API_PORT=443
9. docker-compose up -d --build
10. ¡Accede a https://miempresa.com!
```

#### 3️⃣ Accede desde cualquier lugar

- **Admin Panel**: https://miempresa.com
- **App Flutter**: https://miempresa.com
- **Desde cualquier red**, no solo LAN
- **Completamente seguro**, sin puertos abiertos

**Ejemplo de acceso desde App:**
1. Abre app en teléfono
2. Pantalla login → ⚙️ (settings)
3. Selecciona "Custom"
4. Ingresa: `https://miempresa.com`
5. Click Guardar

---

## Escenario 4: 🔗 **NGROK TUNNEL** (Testing remoto rápido)

### ¿Cuándo usar?
- Necesitas testing rápido sin configurar Cloudflare
- Demostración temporal a cliente
- Testing desde internet sin dominio
- Experimentación de 1-2 horas

### Ventajas:
- No necesitas configurar DNS
- Los cambios se ven en tiempo real
- Excelente para testing remoto

### Pasos:

#### 1️⃣ Descarga NGROK

Descarga desde: https://ngrok.com/download

Descomprime el .zip en algún lugar accesible.

#### 2️⃣ Obtén token de NGROK

- Crea cuenta en https://ngrok.com
- Ve a tu dashboard y copia tu token
- Abre PowerShell en la carpeta de ngrok:

```powershell
./ngrok.exe config add-authtoken <tu-token>
```

#### 3️⃣ Inicia el túnel

En una **terminal aparte**, ejecuta:

```powershell
./ngrok.exe http 3000
```

Verás algo como:

```
ngrok                                                        (Ctrl+C to quit)

Session Status       online
Account              tu@email.com (Plan: Free)
Version              3.5.0
Region               us (United States)
Latency              -
Web Interface        http://127.0.0.1:4040

Forwarding           https://abc123.ngrok.io -> http://localhost:3000
```

**Copia:**  `https://abc123.ngrok.io`

#### 4️⃣ Configura el sistema

```powershell
.\setup-deploy.ps1
```

Selecciona opción **3** y pega la URL: `https://abc123.ngrok.io`

#### 5️⃣ Inicia Docker

```powershell
docker-compose up -d --build
```

#### 6️⃣ Accede desde cualquier lugar

- **Admin Panel**: https://abc123.ngrok.io
- **App Flutter Mobile**: https://abc123.ngrok.io (desde cualquier red)

#### 7️⃣ Compartir con otros

Puedes compartir la URL: `https://abc123.ngrok.io`

Cualquiera en internet puede acceder mientras ngrok esté corriendo.

**⚠️ IMPORTANTE:**
- La URL cambia cada vez que reinicia ngrok
- Apunta a ngrok dashboard http://127.0.0.1:4040 para ver requests
- Plan Free tiene límites de conexiones

---

## Escenario 5: 🖥️ **PRODUCCIÓN CON IP ESTÁTICA** (Servidor con IP pública)

### ¿Cuándo usar?
- Sistema en producción en servidor con IP pública estática
- Dominio permanente (empresa.com, gps.empresa.com, etc)
- Tienes control del servidor Linux/Mac
- Quieres máximo control sobre certificados SSL

**⚠️ NOTA:** Para máquina virtual sin IP pública, usa **Escenario 3 (Cloudflare Tunnel)** en su lugar.

### Pasos:

#### 1️⃣ Obtén un dominio

Opciones:
- GoDaddy
- Namecheap
- Cloudflare

Ejemplo: `gps.empresa.com`

#### 2️⃣ Configura DNS

En tu proveedor de dominio, crea un **A record** que apunte a tu servidor:

```
Type  : A
Name  : gps (o api)
Value : 1.2.3.4 (tu IP del servidor)
TTL   : 3600
```

Espera a que propague (puede tomar 24h)

#### 3️⃣ Obtén certificado SSL (Let's Encrypt)

En tu servidor, instala certbot:

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

Genera certificado:

```bash
sudo certbot certonly --standalone -d gps.empresa.com
```

Los certificados se guardan en:
```
/etc/letsencrypt/live/gps.empresa.com/
```

#### 4️⃣ Configura el sistema

```powershell
.\setup-deploy.ps1
```

Selecciona opción **5** e ingresa tu dominio: `gps.empresa.com`

El .env quedará:
```
DEPLOY_MODE=production
API_DOMAIN=gps.empresa.com
API_PORT=443
```

#### 5️⃣ Actualiza Docker

Edita `docker-compose.yml` para usar HTTPS:

```yaml
environment:
  - CERT_PATH=/etc/letsencrypt/live/gps.empresa.com/fullchain.pem
  - KEY_PATH=/etc/letsencrypt/live/gps.empresa.com/privkey.pem
```

#### 6️⃣ Inicia

```bash
docker-compose up -d --build
```

#### 7️⃣ Accede

- **Admin Panel**: https://gps.empresa.com
- **App Flutter**: https://gps.empresa.com (aparecerá como preset)

---

## 🔄 Cambiar de escenario

Si necesitas cambiar de desarrollo a testing a producción:

#### 1️⃣ Re-ejecuta el script

```powershell
.\setup-deploy.ps1
```

#### 2️⃣ Selecciona nuevo escenario

#### 3️⃣ Reinicia services

```powershell
docker-compose down
docker-compose up -d --build
```

Done! Ahora apunta a la nueva dirección.

---

## 🌐 Resumen Rápido

| Escenario | IP/Dominio | Puerto | URL de Acceso | Mejor para |
|-----------|-----------|--------|---------------|-----------|
| 1️⃣ **Local** | `localhost` | 3000 | http://localhost | Desarrollo en PC |
| 2️⃣ **LAN** | `192.168.0.102` | 3000 | http://192.168.0.102 | Testing con telefóno Android |
| 3️⃣ **Cloudflare** | `miempresa.com` | 443 | https://miempresa.com | **VM sin IP + Dominio** ⭐ |
| 4️⃣ **NGROK** | `abc123.ngrok.io` | 443 | https://abc123.ngrok.io | Testing temporal rápido |
| 5️⃣ **IP Estática** | `gps.empresa.com` | 443 | https://gps.empresa.com | Servidor con IP pública |

---

## 🐛 Troubleshooting

### "Connection refused" en app
- Verifica IP/dominio en compartida
- Confirma que docker-compose esté corriendo: `docker-compose ps`
- Intenta `docker-compose logs api`

### Admin panel carga pero sin datos
- Presiona F12 (DevTools)
- Ve a Network tab
- Verifica que las llamadas a API retornen 200 OK
- Si retorna error, revisa `docker-compose logs api`

### Socket.IO no conecta (no ves actualizaciones)
- Socket usa la misma URL que API
- En navegador DevTools → Network → WS
- Debería haber conexión a `/socket.io`

### NGROK URL cambió
- Reinicia ngrok y copia nueva URL
- Edita .env manualmente o re-ejecuta script
- Reinicia docker: `docker-compose down && docker-compose up -d`

---

## 📚 Más información

- 📄 [DEPLOYMENT_CONFIG.md](DEPLOYMENT_CONFIG.md) - Documentación completa
- 🐳 [Docker Compose](https://docs.docker.com/compose/)
- 🔗 [NGROK Docs](https://ngrok.com/docs)
- 🔐 [Let's Encrypt](https://letsencrypt.org/)

