#!/bin/bash
# ============================================================================
# 🚀 DEPLOY LIMPIO - Solo instala Docker y levanta servicios
# ============================================================================
# Requisito: .env debe existir en la carpeta del proyecto
# Uso: sudo bash deploy.sh

set -e

echo "🚀 GPS Tracker - Deploy System"
echo ""

# ============================================================================
# 1. Verificar que .env existe
# ============================================================================
if [ ! -f ".env" ]; then
    echo "❌ ERROR: No existe .env en la carpeta actual"
    echo ""
    echo "Crea .env con:"
    echo "  DEPLOY_MODE=cloudflare|production|ngrok|local"
    echo "  API_DOMAIN=tudominio.com"
    echo "  API_PORT=443|3000"
    echo "  POSTGRES_DB=tracking"
    echo "  POSTGRES_USER=postgres"
    echo "  POSTGRES_PASSWORD=tu-contraseña"
    echo ""
    exit 1
fi

echo "✅ .env encontrado"
echo ""

# ============================================================================
# 2. Instalar Docker si no existe
# ============================================================================
if ! command -v docker &> /dev/null; then
    echo "📦 Instalando Docker (versión oficial)..."
    
    # Limpiar versiones antiguas
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Instalar desde script oficial
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
    
    # Agregar usuario al grupo docker
    sudo usermod -aG docker $USER 2>/dev/null || true
    
    echo "✅ Docker instalado"
else
    echo "✅ Docker ya existe: $(docker --version)"
fi

echo ""

# ============================================================================
# 3. Instalar Docker Compose si no existe
# ============================================================================
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Instalando Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose instalado"
else
    echo "✅ Docker Compose ya existe: $(docker-compose --version)"
fi

echo ""

# ============================================================================
# 4. Iniciar servicio Docker
# ============================================================================
echo "🔧 Iniciando Docker daemon..."
sudo systemctl enable docker 2>/dev/null || true
sudo systemctl start docker

echo "✅ Docker daemon activo"
echo ""

# ============================================================================
# 5. Levantar servicios
# ============================================================================
echo "🐳 Levantando servicios (PostgreSQL, Redis, API, Admin, Worker)..."
echo ""

sudo docker-compose down 2>/dev/null || true
sudo docker-compose pull || true
sudo docker-compose up -d --build --remove-orphans

echo ""
echo "⏳ Esperando a que los servicios estén listos (10 segundos)..."
sleep 10

echo ""

# ============================================================================
# 6. Estado final
# ============================================================================
echo "📊 Estado de los contenedores:"
echo ""
sudo docker-compose ps

echo ""

# ============================================================================
# 7. Información de acceso
# ============================================================================
DEPLOY_MODE=$(grep "DEPLOY_MODE=" .env | cut -d'=' -f2)
API_DOMAIN=$(grep "API_DOMAIN=" .env | cut -d'=' -f2)
API_PORT=$(grep "API_PORT=" .env | cut -d'=' -f2)

if [ "$API_PORT" == "443" ]; then
    ACCESS_URL="https://$API_DOMAIN"
else
    ACCESS_URL="http://$API_DOMAIN:$API_PORT"
fi

echo "════════════════════════════════════════════════════════════════"
echo "🎉 DESPLIEGUE COMPLETADO"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Configuración:"
echo "  DEPLOY_MODE: $DEPLOY_MODE"
echo "  DOMAIN: $API_DOMAIN"
echo "  PORT: $API_PORT"
echo ""
echo "URLs:"
echo "  🌐 Admin Panel: $ACCESS_URL"
echo "  🔗 API: $ACCESS_URL/api"
echo ""

if [ "$DEPLOY_MODE" == "cloudflare" ]; then
    echo "⚠️  CLOUDFLARE TUNNEL:"
    echo "  Asegúrate de ejecutar en otra terminal:"
    echo "  $ warp-cli tunnel run"
    echo ""
elif [ "$DEPLOY_MODE" == "ngrok" ]; then
    echo "⚠️  NGROK TUNNEL:"
    echo "  Asegúrate de ejecutar en otra terminal:"
    echo "  $ ngrok http 3000"
    echo ""
fi

echo "Logs:"
echo "  $ sudo docker-compose logs -f"
echo ""
echo "Detener servicios:"
echo "  $ sudo docker-compose down"
echo ""
echo "════════════════════════════════════════════════════════════════"
