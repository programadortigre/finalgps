#!/bin/bash
# ============================================================================
# 🔧 FIX DEPLOY SCRIPT - Arregla problemas comunes
# ============================================================================
# Uso: bash fix-deploy.sh

echo "🔧 Reparando deploy.sh..."
echo ""

# 1. Instalar dos2unix si no existe
if ! command -v dos2unix &> /dev/null; then
    echo "1️⃣  Instalando dos2unix (convierte CRLF -> LF)..."
    sudo apt-get update
    sudo apt-get install -y dos2unix
    echo "   ✅ dos2unix instalado"
else
    echo "1️⃣  dos2unix ya está instalado"
fi

# 2. Convertir deploy.sh
echo "2️⃣  Convirtiendo deploy.sh (CRLF -> LF)..."
dos2unix deploy.sh
chmod +x deploy.sh
echo "   ✅ deploy.sh reparado"

# 3. Convertir setup-deploy.sh
echo "3️⃣  Convirtiendo setup-deploy.sh (CRLF -> LF)..."
if [ -f "setup-deploy.sh" ]; then
    dos2unix setup-deploy.sh
    chmod +x setup-deploy.sh
    echo "   ✅ setup-deploy.sh reparado"
fi

echo ""
echo "✅ Todos los scripts están listos"
echo ""
echo "Próximo paso, ejecuta:"
echo "  sudo bash deploy.sh"
echo ""
