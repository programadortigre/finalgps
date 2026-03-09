#!/bin/bash
set -e

echo "🚀 Iniciando despliegue de GPS Tracking System en VPS Ubuntu..."

# 1. Update system and install dependencies
echo "📦 1. Actualizando sistema y verificando dependencias (Docker, Docker-Compose, Git)..."
sudo apt-get update
sudo apt-get install -y docker.io docker-compose git curl ufw

# Auto start docker service
sudo systemctl enable docker
sudo systemctl start docker

# 2. Configurando Firewall UFW
echo "🛡️ 2. Configurando reglas de cortafuegos (Firewall UFW)..."
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp # Internal API
sudo ufw allow 3001/tcp # Socket.io
sudo ufw --force enable

# 3. Preparación del proyecto
echo "📂 3. Preparando directorio del proyecto..."
PROJECT_DIR="/opt/finalgps"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Clonando/Copiando proyecto al servidor. (Asumiremos que ejecutas esto dentro del repo o lo subiste por FTP/Git)"
  sudo mkdir -p $PROJECT_DIR
  sudo cp -r ./* $PROJECT_DIR/ || true
fi

cd $PROJECT_DIR

# 4. Configurar Variables de Entorno (Si no existen)
if [ ! -f ".env" ]; then
    echo "⚠️ .env no encontrado. Creando uno básico para producción..."
    cat <<EOF > .env
POSTGRES_DB=tracking_prod
POSTGRES_USER=gpsadmin
POSTGRES_PASSWORD=$(openssl rand -hex 12)
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=$(openssl rand -base64 32)
JWT_EXPIRATION=30d
API_PORT=3000
NODE_ENV=production
EOF
    echo "✅ .env generado automáticamente con contraseñas seguras."
fi

# 5. Permisos
echo "🔑 5. Asignando permisos..."
subdirs=("api" "worker" "admin-panel" "database")
for dir in "${subdirs[@]}"; do
  if [ -d "$dir" ]; then
     sudo chmod -R 755 $dir
  fi
done

# 6. Levantar todo con Docker Compose
echo "🐳 6. Levantando contenedores (PostgreSQL, Redis, API, Worker, Admin Panel)..."
sudo docker-compose pull || true
sudo docker-compose down
sudo docker-compose up -d --build

# Esperar que levanten los servicios pesados
echo "⏳ Esperando 15s a que base de datos termine de iniciar..."
sleep 15

echo "🛠️ Forzando creación de tablas y datos iniciales (Por si el volumen ya existía)..."
source .env
sudo docker exec -i gps-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < ./database/init.sql || echo "Advertencia: El volcado SQL pudo tener conflictos (normal si ya existía)."

# 7. Verificar estado
echo "✅ 7. Estado final de los contenedores:"
sudo docker-compose ps

echo "🎉 DESPLIEGUE COMPLETADO 🎉"
echo "--------------------------------------------------------"
echo "-> Panel Administrador disponible en: http://TU_DOMAIN_APP"
echo "--------------------------------------------------------"
