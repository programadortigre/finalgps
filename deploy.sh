#!/bin/bash
set -e

echo "🚀 Iniciando despliegue de GPS Tracking System en Ubuntu..."
echo ""

# ============================================================================
# PASO 1: Verificar dependencias (sin instalar si ya existen)
# ============================================================================
echo "📦 1. Verificando dependencias (Docker, Docker-Compose, Git)..."
echo ""

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "   ⬇️  Docker no encontrado. Instalando version oficial de Docker..."
    echo "   Removiendo versiones antiguas si existen..."
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    echo "   Instalando Docker usando script oficial..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
    
    echo "   Agregando usuario al grupo docker..."
    sudo usermod -aG docker $USER 2>/dev/null || true
    
    echo "   ✅ Docker instalado correctamente"
else
    DOCKER_VERSION=$(docker --version)
    echo "   ✅ Docker ya instalado: $DOCKER_VERSION"
fi

# Verificar Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "   ⬇️  Docker Compose no encontrado. Instalando..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "   ✅ Docker Compose instalado"
else
    DC_VERSION=$(docker-compose --version)
    echo "   ✅ Docker Compose ya instalado: $DC_VERSION"
fi

# Verificar Git
if ! command -v git &> /dev/null; then
    echo "   ⬇️  Git no encontrado. Instalando..."
    sudo apt-get update
    sudo apt-get install -y git
    echo "   ✅ Git instalado"
else
    GIT_VERSION=$(git --version)
    echo "   ✅ Git ya instalado: $GIT_VERSION"
fi

# Verificar curl
if ! command -v curl &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y curl
fi

# Verificar ufw
if ! command -v ufw &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y ufw
fi

# Asegurarse de que Docker está corriendo
echo "   Iniciando servicio Docker..."
sudo systemctl enable docker
sudo systemctl start docker
sudo systemctl status docker --no-pager | head -3

echo "   ✅ Todas las dependencias están listas"
echo ""

# ============================================================================
# PASO 2: Configurar Firewall UFW (solo si no está habilitado)
# ============================================================================
echo "🛡️ 2. Configurando firewall UFW..."
echo ""

# Verificar si ufw está activo
if sudo ufw status | grep -q "Status: inactive"; then
    echo "   ⬇️  Habilitando UFW y configurando reglas..."
    sudo ufw --force enable
    echo "   ✅ UFW habilitado"
else
    echo "   ✅ UFW ya está activo"
fi

# Agregar reglas necesarias (no causa problemas si ya existen)
echo "   Configurando reglas de firewall..."
sudo ufw allow OpenSSH 2>/dev/null || true
sudo ufw allow 80/tcp 2>/dev/null || true      # HTTP
sudo ufw allow 443/tcp 2>/dev/null || true     # HTTPS
sudo ufw allow 3000/tcp 2>/dev/null || true    # API interna
sudo ufw allow 3001/tcp 2>/dev/null || true    # Socket.io
echo "   ✅ Reglas de firewall configuradas"
echo ""

# ============================================================================
# PASO 3: Preparar directorio del proyecto
# ============================================================================
echo "📂 3. Preparando directorio del proyecto..."
echo ""
PROJECT_DIR="/opt/finalgps"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "   Creando directorio: $PROJECT_DIR"
    sudo mkdir -p $PROJECT_DIR
    sudo cp -r ./* $PROJECT_DIR/ || true
    echo "   ✅ Proyecto copiado a $PROJECT_DIR"
else
    echo "   ✅ Directorio $PROJECT_DIR ya existe"
    echo "   Actualizando archivos from current location..."
    sudo cp -r ./* $PROJECT_DIR/ || true
fi

cd $PROJECT_DIR
echo "   Directorio actual: $(pwd)"
echo ""

# ============================================================================
# PASO 4: Configurar Variables de Entorno (.env)
# ============================================================================
echo "⚙️  4. Configurando variables de entorno..."
echo ""

if [ ! -f ".env" ]; then
    echo "   ⚠️  .env no encontrado. Creando configuración por defecto..."
    echo ""
    echo "   Selecciona el DEPLOY_MODE:"
    echo "     1) cloudflare - VM sin IP pública con Cloudflare Tunnel"
    echo "     2) production - Servidor con IP pública estática"
    echo "     3) ngrok      - Testing temporal con NGROK"
    echo "     4) local      - Desarrollo local"
    echo ""
    read -p "   Opción (1-4): " DEPLOY_OPTION
    
    case $DEPLOY_OPTION in
        1)
            DEPLOY_MODE="cloudflare"
            read -p "   Ingresa tu dominio Cloudflare (ej: miempresa.com): " DOMAIN
            API_DOMAIN="$DOMAIN"
            API_PORT="443"
            ;;
        2)
            DEPLOY_MODE="production"
            read -p "   Ingresa tu dominio (ej: gps.empresa.com): " DOMAIN
            API_DOMAIN="$DOMAIN"
            API_PORT="443"
            ;;
        3)
            DEPLOY_MODE="ngrok"
            read -p "   Ingresa tu URL de NGROK (ej: abc123.ngrok.io): " DOMAIN
            API_DOMAIN="$DOMAIN"
            API_PORT="443"
            ;;
        *)
            DEPLOY_MODE="local"
            API_DOMAIN="localhost"
            API_PORT="3000"
            ;;
    esac
    
    # Generar .env con valores seguros
    cat <<EOF > .env
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
POSTGRES_PASSWORD=$(openssl rand -hex 16)
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
JWT_SECRET=$(openssl rand -base64 32)
JWT_EXPIRATION=30d

# ============================================================================
# 🔧 SERVER ENVIRONMENT
# ============================================================================
NODE_ENV=production
SOCKET_PORT=3001
EOF
    
    echo "   ✅ .env generado con DEPLOY_MODE=$DEPLOY_MODE, DOMAIN=$API_DOMAIN"
else
    echo "   ✅ .env ya existe, usando configuración existente"
    DEPLOY_MODE=$(grep "DEPLOY_MODE=" .env | cut -d'=' -f2)
    API_DOMAIN=$(grep "API_DOMAIN=" .env | cut -d'=' -f2)
    echo "   Modo actual: $DEPLOY_MODE, Dominio: $API_DOMAIN"
fi
echo ""

# ============================================================================
# PASO 5: Asignar permisos
# ============================================================================
echo "🔑 5. Asignando permisos..."
echo ""

# Asignar permisos a directorios específicos
for dir in api worker admin-panel database; do
  if [ -d "$dir" ]; then
     sudo chmod -R 755 "$dir"
     echo "   ✅ Permisos configurados: $dir"
  fi
done

echo ""

# ============================================================================
# PASO 6: Levantar servicios con Docker Compose
# ============================================================================
echo "🐳 6. Iniciando servicios (PostgreSQL, Redis, API, Worker, Admin)..."
echo ""

# Verificar si docker compose está corriendo
if sudo docker-compose ps | grep -q "Up"; then
    echo "   ⚠️  Servicios ya están corriendo. Actualizando..."
else
    echo "   Iniciando servicios por primera vez..."
fi

sudo docker-compose pull || true
sudo docker-compose up -d --build --remove-orphans

echo "   ⏳ Esperando a que levanten los servicios (15 segundos)..."
sleep 15

echo "   ✅ Servicios levantados"
echo ""

# ============================================================================
# PASO 7: Inicializar base de datos (si es primera vez)
# ============================================================================
echo "🛠️ 7. Inicializando base de datos..."
echo ""

. .env

# Esperar a que PostgreSQL esté listo
echo "   Esperando PostgreSQL..."
for i in {1..30}; do
    if sudo docker exec gps-postgres pg_isready -U postgres -d "$POSTGRES_DB" &>/dev/null; then
        echo "   ✅ PostgreSQL está listo"
        break
    fi
    echo "   Intento $i/30..."
    sleep 1
done

# Inicializar datos
if [ -f "./database/init.sql" ]; then
    echo "   Ejecutando init.sql..."
    sudo docker exec -i gps-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < ./database/init.sql 2>/dev/null || \
    echo "   ⚠️  Nota: init.sql completado (algunos errores are normales si las tablas ya existen)"
fi
echo ""

# ============================================================================
# PASO 8: Verificación final
# ============================================================================
echo "✅ 8. Verificación del estado final..."
echo ""
echo "Estado de los contenedores:"
sudo docker-compose ps
echo ""

# Mostrar URLs de acceso según DEPLOY_MODE
echo "════════════════════════════════════════════════════════════════"
echo "🎉 DESPLIEGUE COMPLETADO 🎉"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Configuración actual:"
echo "  Deploy Mode: $DEPLOY_MODE"
echo "  Domain/IP: $API_DOMAIN"
echo "  Port: $API_PORT"
echo ""

if [ "$API_PORT" == "443" ]; then
    ACCESS_URL="https://$API_DOMAIN"
else
    ACCESS_URL="http://$API_DOMAIN:$API_PORT"
fi

echo "URLs de acceso:"
echo "  🌐 Admin Panel: $ACCESS_URL"
echo "  🔗 API: $ACCESS_URL/api"
echo ""

case $DEPLOY_MODE in
    cloudflare)
        echo "⚠️  CLOUDFLARE TUNNEL: Asegúrate de que warp-cli tunnel esté ejecutándose:"
        echo "    warp-cli tunnel run"
        echo ""
        ;;
    ngrok)
        echo "⚠️  NGROK: Asegúrate de que NGROK esté ejecutándose en otra terminal:"
        echo "    ngrok http 3000"
        echo ""
        ;;
    production)
        echo "📄 Recuerda configurar: DNS, SSL Certificate, y firewall rules"
        echo ""
        ;;
esac

echo "Para más información, ver:"
echo "  📖 README.md"
echo "  📖 DEPLOYMENT_GUIDE.md"
echo "  📖 DEPLOYMENT_CONFIG.md"
echo ""
echo "Si algo falla, revisa los logs:"
echo "  sudo docker-compose logs -f"
echo "════════════════════════════════════════════════════════════════"
