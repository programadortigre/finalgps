#!/bin/bash
# ============================================================================
# 🚀 DEPLOY CONFIGURATION WIZARD
# ============================================================================
# Uso: bash setup-deploy.sh
# Este script te ayuda a configurar el ambiente de deploy interactivamente

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║     🚀 GPS TRACKER - DEPLOYMENT CONFIGURATION WIZARD           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Crear backup del .env actual si existe
if [ -f ".env" ]; then
    cp .env .env.backup.$(date +%s)
    echo "✅ Backup de .env creado"
fi

# Seleccionar escenario
echo "📋 Selecciona tu escenario de deploy:"
echo ""
echo "  1) 🏠 Local Development (localhost:3000)"
echo "  2) 🖥️ Local Network (192.168.x.x:3000)"
echo "  3) ☁️  Cloudflare Tunnel (dominio + VM sin IP)"
echo "  4) 🔗 NGROK Tunnel (testing remoto temporal)"
echo "  5) 🖥️  Production con IP Estática (tu servidor con IP pública)"
echo ""
read -p "Opción: " OPTION

case $OPTION in
    1)
        DEPLOY_MODE="local"
        API_DOMAIN="localhost"
        API_PORT="3000"
        DESCRIPTION="Local Development"
        ;;
    2)
        echo ""
        echo "Encuentra tu IP local con: ipconfig (Windows) o ifconfig (Mac/Linux)"
        echo "Busca 'IPv4 Address' en la sección de tu red WiFi"
        echo ""
        read -p "Ingresa tu IP local (ej: 192.168.0.102): " IP_INPUT
        DEPLOY_MODE="local-network"
        API_DOMAIN="$IP_INPUT"
        API_PORT="3000"
        DESCRIPTION="Local Network - IP: $IP_INPUT"
        ;;
    3)
        echo ""
        echo "🌐 CLOUDFLARE TUNNEL - Producción Segura"
        echo ""
        echo "Para configurar Cloudflare Tunnel, sigue:"
        echo "👉 CLOUDFLARE_TUNNEL_GUIDE.md (en inglés) o CLOUDFLARE_TUNNEL_GUIDE_ES.md"
        echo ""
        echo "Pasos rápidos:"
        echo "1. Compra dominio (godaddy.com, namecheap.com)"
        echo "2. Agrégalo a Cloudflare (cloudflare.com gratis)"
        echo "3. Instala warp-cli"
        echo "4. warp-cli tunnel create gps-tracker"
        echo "5. Configura ~/.warp/config.toml"
        echo "6. warp-cli tunnel run (en terminal separada)"
        echo ""
        read -p "Ingresa tu dominio Cloudflare (ej: miempresa.com): " DOMAIN_INPUT
        DOMAIN_INPUT=${DOMAIN_INPUT#*://}
        DOMAIN_INPUT=${DOMAIN_INPUT%/}
        DEPLOY_MODE="cloudflare"
        API_DOMAIN="$DOMAIN_INPUT"
        API_PORT="443"
        DESCRIPTION="Cloudflare Tunnel - Domain: $DOMAIN_INPUT"
        ;;
    4)
        echo ""
        echo "1. Abre otra terminal y ejecuta: ngrok http 3000"
        echo "2. Copia la URL que muestra (ej: https://abc123.ngrok.io)"
        echo ""
        read -p "Ingresa tu URL de NGROK: " NGROK_URL
        # Remover http/https si lo puso
        NGROK_URL=${NGROK_URL#*://}
        NGROK_URL=${NGROK_URL%/}
        DEPLOY_MODE="ngrok"
        API_DOMAIN="$NGROK_URL"
        API_PORT="443"
        DESCRIPTION="NGROK Tunnel - URL: https://$NGROK_URL"
        ;;
    5)
        echo ""
        read -p "Ingresa tu dominio de producción (ej: gps.empresa.com): " DOMAIN_INPUT
        DOMAIN_INPUT=${DOMAIN_INPUT#*://}
        DOMAIN_INPUT=${DOMAIN_INPUT%/}
        DEPLOY_MODE="production"
        API_DOMAIN="$DOMAIN_INPUT"
        API_PORT="443"
        DESCRIPTION="Production - IP Estática - Domain: $DOMAIN_INPUT"
        ;;
    *)
        echo "❌ Opción inválida"
        exit 1
        ;;
esac

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║ 📝 CONFIRMACIÓN DE CONFIGURACIÓN                              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Escenario: $DESCRIPTION"
echo "  Modo Deploy: $DEPLOY_MODE"
echo "  Dominio/IP: $API_DOMAIN"
echo "  Puerto: $API_PORT"
echo ""

# Construir URL de acceso
if [ "$API_PORT" = "443" ]; then
    ACCESS_URL="https://$API_DOMAIN"
else
    ACCESS_URL="http://$API_DOMAIN:$API_PORT"
fi

echo "  URL de Acceso: $ACCESS_URL"
echo ""

read -p "¿Confirmar esta configuración? (s/n): " CONFIRM

if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
    echo "❌ Configuración cancelada"
    exit 1
fi

echo ""

# Actualizar .env
cat > .env << EOF
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

# ============================================================================
# CONFIGURADO EL: $(date)
# ============================================================================
EOF

echo "✅ Archivo .env actualizado"
echo ""

# Crear .env.local para admin panel
cat > admin-panel/.env.local << EOF
# Admin Panel - Configurado el $(date)
VITE_API_URL=$ACCESS_URL
EOF

echo "✅ Archivo admin-panel/.env.local actualizado"
echo ""

# Mostrar instrucciones finales
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║ 🎯 PRÓXIMOS PASOS                                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

case $DEPLOY_MODE in
    "local")
        echo "1. Inicia Docker Desktop"
        echo "2. Ejecuta: docker-compose up -d --build"
        echo "3. Abre el navegador: http://localhost"
        echo ""
        echo "Para la app Flutter: usa el preset 'Local (Dev)' en login"
        ;;
    "local-network")
        echo "1. Asegúrate que tu puerto 3000 esté abierto en Windows Firewall"
        echo "2. Inicia Docker Desktop"
        echo "3. Ejecuta: docker-compose up -d --build"
        echo "4. Abre el navegador: $ACCESS_URL"
        echo ""
        echo "Para la app Flutter:"
        echo "   - En pantalla de login, presiona el ícono ⚙️"
        echo "   - Selecciona 'Custom' e ingresa: $ACCESS_URL"
        echo ""
        echo "⚠️  Asegúrate de estar en la MISMA red WiFi"
        ;;
    "ngrok")
        echo "1. Ngrok debe estar ejecutándose en otra terminal: ngrok http 3000"
        echo "2. Inicia Docker Desktop"
        echo "3. Ejecuta: docker-compose up -d --build"
        echo "4. Abre el navegador: $ACCESS_URL"
        echo ""
        echo "Para la app Flutter:"
        echo "   - En pantalla de login, presiona el ícono ⚙️"
        echo "   - Selecciona 'Custom' e ingresa: $ACCESS_URL"
        echo ""
        echo "⚠️  Nota: La URL de ngrok cambia cada vez. Actualiza cuando reinicies ngrok"
        ;;
    "production")
        echo "1. Asegúrate de tener un certificado SSL válido"
        echo "2. Configura tu DNS para apuntar a este servidor"
        echo "3. Ejecuta: docker-compose up -d --build"
        echo "4. Abre el navegador: $ACCESS_URL"
        echo ""
        echo "Para la app Flutter: La URL apareceríe automáticadecomo preset"
        ;;
esac

echo ""
echo "✅ Configuración completada!"
echo ""
echo "Para más información, consulta: DEPLOYMENT_CONFIG.md"
