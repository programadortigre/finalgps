# ============================================================================
# 🚀 DEPLOY CONFIGURATION WIZARD (PowerShell)
# ============================================================================
# Uso: .\setup-deploy.ps1
# Este script te ayuda a configurar el ambiente de deploy interactivamente

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🚀 GPS TRACKER - DEPLOYMENT CONFIGURATION WIZARD" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Crear backup del .env actual si existe
if (Test-Path ".env") {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    Copy-Item ".env" ".env.backup_$timestamp"
    Write-Host "✅ Backup de .env creado (.env.backup_$timestamp)" -ForegroundColor Green
}

# Seleccionar escenario
Write-Host "📋 Selecciona tu escenario de deploy:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1) 🏠 Local Development (localhost:3000)"
Write-Host "  2) 🖥️  Local Network (192.168.x.x:3000)"
Write-Host "  3) ☁️  Cloudflare Tunnel (dominio + VM sin IP)"
Write-Host "  4) 🔗 NGROK Tunnel (testing remoto temporal)"
Write-Host "  5) 🖥️  Production con IP Estática (tu servidor con IP pública)"
Write-Host ""

$option = Read-Host "Opción"

$DEPLOY_MODE = ""
$API_DOMAIN = ""
$API_PORT = ""
$DESCRIPTION = ""

switch ($option) {
    "1" {
        $DEPLOY_MODE = "local"
        $API_DOMAIN = "localhost"
        $API_PORT = "3000"
        $DESCRIPTION = "Local Development"
    }
    "2" {
        Write-Host ""
        Write-Host "Encuentra tu IP local con: ipconfig en PowerShell" -ForegroundColor Yellow
        Write-Host "Busca 'IPv4 Address' en tu adaptador de red WiFi" -ForegroundColor Yellow
        Write-Host ""
        $API_DOMAIN = Read-Host "Ingresa tu IP local (ej: 192.168.0.102)"
        $DEPLOY_MODE = "local-network"
        $API_PORT = "3000"
        $DESCRIPTION = "Local Network - IP: $API_DOMAIN"
    }
    "3" {
        Write-Host ""
        Write-Host "🌐 CLOUDFLARE TUNNEL - Producción Segura" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Para configurar Cloudflare Tunnel, sigue:" -ForegroundColor Yellow
        Write-Host "👉 CLOUDFLARE_TUNNEL_GUIDE.md" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Pasos rápidos:" -ForegroundColor Yellow
        Write-Host "1. Compra dominio (godaddy.com, namecheap.com)"
        Write-Host "2. Agrégalo a Cloudflare (cloudflare.com gratis)"
        Write-Host "3. Instala warp-cli"
        Write-Host "4. warp-cli tunnel create gps-tracker"
        Write-Host "5. Configura ~/.warp/config.toml"
        Write-Host "6. warp-cli tunnel run (en terminal separada)"
        Write-Host ""
        $DOMAIN_INPUT = Read-Host "Ingresa tu dominio Cloudflare (ej: miempresa.com)"
        $DOMAIN_INPUT = $DOMAIN_INPUT -replace "^https?://", ""
        $DOMAIN_INPUT = $DOMAIN_INPUT -replace "/$", ""
        $DEPLOY_MODE = "cloudflare"
        $API_DOMAIN = $DOMAIN_INPUT
        $API_PORT = "443"
        $DESCRIPTION = "Cloudflare Tunnel - Domain: $DOMAIN_INPUT"
    }
    "4" {
        Write-Host ""
        Write-Host "1. Abre otra terminal PowerShell y ejecuta: ngrok http 3000" -ForegroundColor Yellow
        Write-Host "2. Copia la URL que muestra (ej: https://abc123.ngrok.io)" -ForegroundColor Yellow
        Write-Host ""
        $NGROK_URL = Read-Host "Ingresa tu URL de NGROK"
        # Remover http/https si lo puso
        $NGROK_URL = $NGROK_URL -replace "^https?://", ""
        $NGROK_URL = $NGROK_URL -replace "/$", ""
        $DEPLOY_MODE = "ngrok"
        $API_DOMAIN = $NGROK_URL
        $API_PORT = "443"
        $DESCRIPTION = "NGROK Tunnel - URL: https://$NGROK_URL"
    }
    "5" {
        Write-Host ""
        $DOMAIN_INPUT = Read-Host "Ingresa tu dominio de producción (ej: gps.empresa.com)"
        $DOMAIN_INPUT = $DOMAIN_INPUT -replace "^https?://", ""
        $DOMAIN_INPUT = $DOMAIN_INPUT -replace "/$", ""
        $DEPLOY_MODE = "production"
        $API_DOMAIN = $DOMAIN_INPUT
        $API_PORT = "443"
        $DESCRIPTION = "Production - IP Estática - Domain: $DOMAIN_INPUT"
    }
    default {
        Write-Host "❌ Opción inválida" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  📝 CONFIRMACIÓN DE CONFIGURACIÓN" -ForegroundColor Yellow
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Escenario: $DESCRIPTION" -ForegroundColor Green
Write-Host "  Modo Deploy: $DEPLOY_MODE"
Write-Host "  Dominio/IP: $API_DOMAIN"
Write-Host "  Puerto: $API_PORT"
Write-Host ""

# Construir URL de acceso
if ($API_PORT -eq "443") {
    $ACCESS_URL = "https://$API_DOMAIN"
}
else {
    $ACCESS_URL = "http://$API_DOMAIN`:$API_PORT"
}

Write-Host "  URL de Acceso: $ACCESS_URL" -ForegroundColor Cyan
Write-Host ""

$CONFIRM = Read-Host "¿Confirmar esta configuración? (s/n)"

if ($CONFIRM -ne "s" -and $CONFIRM -ne "S") {
    Write-Host "❌ Configuración cancelada" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Crear contenido del .env
$envContent = @"
# ============================================================================
# 🚀 DEPLOY CONFIGURATION
# ============================================================================
DEPLOY_MODE=$DEPLOY_MODE
API_DOMAIN=$API_DOMAIN
API_PORT=$API_PORT

# ============================================================================
# 📊 DATABASE
# ============================================================================
POSTGRES_DB=tracking
POSTGRES_USER=postgres
POSTGRES_PASSWORD=supersecure-2024-change-in-production
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

# ============================================================================
# 💾 CACHE / MESSAGE BROKER
# ============================================================================
REDIS_HOST=redis
REDIS_PORT=6379

# ============================================================================
# 🔐 AUTHENTICATION
# ============================================================================
JWT_SECRET=supersecret-gps-tracking-2024-change-in-production
JWT_EXPIRATION=7d

# ============================================================================
# 🔧 SERVER ENVIRONMENT
# ============================================================================
NODE_ENV=development
SOCKET_PORT=3001

# ============================================================================
# 📝 Logging
# ============================================================================
LOG_LEVEL=info

# Configurado el: $(Get-Date)
"@

# Usar Set-Content en lugar de out-file para evitar encoding issues
$envContent | Out-File -FilePath ".env" -Encoding utf8 -Force

Write-Host "✅ Archivo .env actualizado" -ForegroundColor Green
Write-Host ""

# Crear .env.local para admin panel
$adminEnvContent = @"
# Admin Panel - Configurado el $(Get-Date)
VITE_API_URL=$ACCESS_URL
"@

$adminEnvContent | Out-File -FilePath "admin-panel\.env.local" -Encoding utf8 -Force

Write-Host "✅ Archivo admin-panel\.env.local actualizado" -ForegroundColor Green
Write-Host ""

# Mostrar instrucciones finales
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🎯 PRÓXIMOS PASOS" -ForegroundColor Yellow
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

switch ($DEPLOY_MODE) {
    "local" {
        Write-Host "1. Inicia Docker Desktop" -ForegroundColor Cyan
        Write-Host "2. Ejecuta: docker-compose up -d --build" -ForegroundColor Cyan
        Write-Host "3. Abre el navegador: http://localhost" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Para la app Flutter: usa el preset 'Local (Dev)' en login" -ForegroundColor Yellow
    }
    "local-network" {
        Write-Host "1. Abre PowerShell como Administrador Y ejecuta:" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "   New-NetFirewallRule -DisplayName 'GPS Tracker API' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000" -ForegroundColor Green
        Write-Host ""
        Write-Host "2. Inicia Docker Desktop" -ForegroundColor Cyan
        Write-Host "3. Ejecuta: docker-compose up -d --build" -ForegroundColor Cyan
        Write-Host "4. Abre el navegador: $ACCESS_URL" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Para la app Flutter:" -ForegroundColor Yellow
        Write-Host "   - En pantalla de login, presiona el ícono ⚙️" -ForegroundColor Yellow
        Write-Host "   - Selecciona 'Custom' e ingresa: $ACCESS_URL" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "⚠️  Asegúrate de estar en la MISMA red WiFi" -ForegroundColor Yellow
    }
    "ngrok" {
        Write-Host "1. Abre PowerShell en otra terminal Y ejecuta: ngrok http 3000" -ForegroundColor Cyan
        Write-Host "   (Descarga ngrok de https://ngrok.com si no lo tienes)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "2. Inicia Docker Desktop" -ForegroundColor Cyan
        Write-Host "3. Ejecuta: docker-compose up -d --build" -ForegroundColor Cyan
        Write-Host "4. Abre el navegador: $ACCESS_URL" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Para la app Flutter:" -ForegroundColor Yellow
        Write-Host "   - En pantalla de login, presiona el ícono ⚙️" -ForegroundColor Yellow
        Write-Host "   - Selecciona 'Custom' e ingresa: $ACCESS_URL" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "⚠️  Nota: La URL de ngrok cambia cada vez. Actualiza .env cuando reinicies ngrok" -ForegroundColor Yellow
    }
    "production" {
        Write-Host "1. Asegúrate de tener un certificado SSL válido"
        Write-Host "2. Configura tu DNS para apuntar a este servidor"
        Write-Host "3. Ejecuta: docker-compose up -d --build"
        Write-Host "4. Abre el navegador: $ACCESS_URL" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Para la app Flutter: La URL aparecerá automáticamente como preset" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "✅ ¡Configuración completada!" -ForegroundColor Green
Write-Host ""
Write-Host "Para más información, consulta: DEPLOYMENT_CONFIG.md" -ForegroundColor Cyan
Write-Host ""
