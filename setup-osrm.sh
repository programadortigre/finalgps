#!/bin/bash

# ============================================================================
# GPS TRACKER - OSRM SETUP SCRIPT
# ============================================================================
# Descarga y configura los datos de OSRM para Perú
# Uso: bash setup-osrm.sh
# ============================================================================

set -e

echo "🗺️  GPS Tracker - OSRM Setup"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detectar sistema operativo
OS_TYPE="$(uname -s)"
if [[ "$OS_TYPE" == "MINGW64_NT"* ]] || [[ "$OS_TYPE" == "MSYS_NT"* ]]; then
    echo -e "${RED}❌ Este script está diseñado para Linux/Mac${NC}"
    echo "Para Windows, ejecuta en WSL2 o en tu VM Ubuntu"
    exit 1
fi

# ============================================================================
# STEP 1: Crear directorio
# ============================================================================
echo -e "${YELLOW}📁 PASO 1: Verificando directorio osrm_data...${NC}"
mkdir -p ./osrm_data
echo -e "${GREEN}✅ Directorio creado: ./osrm_data${NC}"
echo ""

# ============================================================================
# STEP 2: Verificar espacio en disco
# ============================================================================
echo -e "${YELLOW}💾 PASO 2: Verificando espacio en disco...${NC}"
AVAILABLE=$(df ./osrm_data | awk 'NR==2 {print int($4/1024/1024)}')
REQUIRED=3500  # ~3.5GB

if [ "$AVAILABLE" -lt "$REQUIRED" ]; then
    echo -e "${RED}❌ Espacio insuficiente!${NC}"
    echo "   Disponible: ${AVAILABLE}MB"
    echo "   Requerido: ~${REQUIRED}MB"
    echo "   Libera espacio e intenta de nuevo"
    exit 1
fi
echo -e "${GREEN}✅ Espacio suficiente: ${AVAILABLE}MB${NC}"
echo ""

# ============================================================================
# STEP 3: Descargar datos de Perú
# ============================================================================
echo -e "${YELLOW}⬇️  PASO 3: Descargando peru-latest.osm.pbf...${NC}"
echo "   Fuente: https://download.geofabrik.de"
echo "   Tamaño: ~350MB"
echo "   Esto puede tomar 5-15 minutos..."
echo ""

OSM_FILE="./osrm_data/peru-latest.osm.pbf"

if [ -f "$OSM_FILE" ]; then
    echo -e "${YELLOW}⚠️  Archivo ya existe: $OSM_FILE${NC}"
    read -p "¿Descargar de nuevo? (s/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        echo "Saltando descarga..."
    else
        rm -f "$OSM_FILE"
        wget -O "$OSM_FILE" "https://download.geofabrik.de/south-america/peru-latest.osm.pbf"
    fi
else
    wget -O "$OSM_FILE" "https://download.geofabrik.de/south-america/peru-latest.osm.pbf"
fi

if [ ! -f "$OSM_FILE" ]; then
    echo -e "${RED}❌ Error: No se pudo descargar el archivo${NC}"
    exit 1
fi

FILE_SIZE=$(du -h "$OSM_FILE" | cut -f1)
echo -e "${GREEN}✅ Descargado: $FILE_SIZE${NC}"
echo ""

# ============================================================================
# STEP 4: Compilar con Docker
# ============================================================================
echo -e "${YELLOW}🔧 PASO 4: Compilando con OSRM...${NC}"
echo "   Esta es la parte larga: 20-40 minutos"
echo "   Asegúrate de tener Docker corriendo"
echo ""

# Detectar si Docker está disponible
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker no instalado!${NC}"
    echo "Instala Docker primero: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "Paso 4a: osrm-extract (10-20 min)..."
docker run --rm -t \
    -v "$(pwd)/osrm_data:/data" \
    osrm/osrm-backend:latest \
    osrm-extract -p /opt/osrm/profiles/car.lua /data/peru-latest.osm.pbf

if [ ! -f "./osrm_data/peru-latest.osrm" ]; then
    echo -e "${RED}❌ Error en osrm-extract${NC}"
    exit 1
fi
echo -e "${GREEN}✅ osrm-extract completado${NC}"
echo ""

echo "Paso 4b: osrm-partition (2-5 min)..."
docker run --rm -t \
    -v "$(pwd)/osrm_data:/data" \
    osrm/osrm-backend:latest \
    osrm-partition /data/peru-latest.osrm

echo -e "${GREEN}✅ osrm-partition completado${NC}"
echo ""

echo "Paso 4c: osrm-customize (5-10 min)..."
docker run --rm -t \
    -v "$(pwd)/osrm_data:/data" \
    osrm/osrm-backend:latest \
    osrm-customize /data/peru-latest.osrm

echo -e "${GREEN}✅ osrm-customize completado${NC}"
echo ""

# ============================================================================
# STEP 5: Verificar archivos
# ============================================================================
echo -e "${YELLOW}📋 PASO 5: Verificando archivos compilados...${NC}"

REQUIRED_FILES=(
    "peru-latest.osrm"
    "peru-latest.osrm.edges"
    "peru-latest.osrm.ramIndex"
    "peru-latest.osrm.fileIndex"
    "peru-latest.osrm.geometry"
    "peru-latest.osrm.names"
    "peru-latest.osrm.datasource_names"
    "peru-latest.osrm.icd"
    "peru-latest.osrm.maneuver_overrides"
    "peru-latest.osrm.turn_weight_penalties"
    "peru-latest.osrm.turn_duration_penalties"
    "peru-latest.osrm.timestamp"
)

ALL_GOOD=true
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "./osrm_data/$file" ]; then
        SIZE=$(du -h "./osrm_data/$file" | cut -f1)
        echo -e "${GREEN}✅${NC} $file ($SIZE)"
    else
        echo -e "${RED}❌${NC} $file (FALTA!)"
        ALL_GOOD=false
    fi
done

echo ""

if [ "$ALL_GOOD" = false ]; then
    echo -e "${RED}❌ Faltan archivos. Verifica los logs arriba.${NC}"
    exit 1
fi

# ============================================================================
# STEP 6: Listo para producción
# ============================================================================
echo -e "${GREEN}"
echo "╔════════════════════════════════════╗"
echo "║  ✅ SETUP COMPLETADO!              ║"
echo "╚════════════════════════════════════╝"
echo -e "${NC}"

echo ""
echo "Próximos pasos:"
echo "1. Inicia Docker: sudo docker-compose up -d --build"
echo "2. Verifica OSRM: sudo docker-compose logs -f osrm"
echo "3. Espera hasta ver: [info] starting service on: 0.0.0.0:5000"
echo "4. Test: curl http://localhost:5000/status"
echo ""

echo "📊 Datos compilados:"
TOTAL_SIZE=$(du -sh ./osrm_data | cut -f1)
echo "   Tamaño total: $TOTAL_SIZE"
echo "   Ubicación: $(pwd)/osrm_data"
echo ""

echo -e "${GREEN}¡Listo para usar!${NC}"
