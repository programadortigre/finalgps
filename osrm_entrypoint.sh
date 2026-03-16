#!/bin/bash

# ============================================================================
# OSRM Entrypoint Script
# ============================================================================
# Verifica si los datos de OSRM existen
# Si no, los descarga y compila automáticamente
# Luego inicia el servicio OSRM
# ============================================================================

set -e

OSRM_DATA_DIR="/data"
OSM_FILE="$OSRM_DATA_DIR/peru-latest.osm.pbf"
OSRM_FILE="$OSRM_DATA_DIR/peru-latest.osrm"

echo "[OSRM] Initializing OSRM service..."

# ============================================================================
# STEP 1: Verificar si datos ya existen
# ============================================================================
if [ -f "$OSRM_FILE" ] && [ -f "$OSRM_DATA_DIR/peru-latest.osrm.edges" ]; then
    echo "[OSRM] ✅ Datos compilados encontrados. Saltando compilación..."
    # Continúa directo a iniciar OSRM
else
    echo "[OSRM] ⚠️  Datos no encontrados. Iniciando descarga y compilación..."
    echo "[OSRM] Esto puede tomar 30-50 minutos. Por favor espera..."
    echo ""
    
    # ============================================================================
    # STEP 2: Descargar datos si el .pbf no existe
    # ============================================================================
    if [ ! -f "$OSM_FILE" ]; then
        echo "[OSRM] ⬇️  Descargando peru-latest.osm.pbf (~350MB)..."
        echo "[OSRM] Fuente: https://download.geofabrik.de"
        echo ""
        
    # Intenta descarga con reintentos
    MAX_RETRIES=3
    RETRY=0
    
    while [ $RETRY -lt $MAX_RETRIES ]; do
        if wget -O "$OSM_FILE" \
            "https://download.geofabrik.de/south-america/peru-latest.osm.pbf" 2>&1; then
            echo ""
            echo "[OSRM] ✅ Descarga completada"
            break
        else
            RETRY=$((RETRY + 1))
            if [ $RETRY -lt $MAX_RETRIES ]; then
                echo "[OSRM] ⚠️  Descarga fallida. Reintentando ($RETRY/$MAX_RETRIES)..."
                sleep 5
            else
                echo "[OSRM] ❌ Descarga fallida después de $MAX_RETRIES intentos"
                echo "[OSRM] Por favor verifica tu conexión a Internet"
                exit 1
            fi
        fi
    done
        echo ""
    else
        echo "[OSRM] OSM file ya existe: $OSM_FILE"
    fi
    
    # ============================================================================
    # STEP 3: Compilar datos 
    # ============================================================================
    echo "[OSRM] 🔧 Compilando datos de OSRM..."
    echo "[OSRM] Esto puede tomar 20-40 minutos..."
    echo ""
    
    # Verificar espacio en disco
    AVAILABLE=$(df "$OSRM_DATA_DIR" | awk 'NR==2 {print int($4/1024)}')
    if [ "$AVAILABLE" -lt 2500000 ]; then
        echo "[OSRM] ❌ Espacio insuficiente en disco"
        echo "[OSRM] Disponible: ${AVAILABLE}MB, Requerido: ~2500MB"
        exit 1
    fi
    
    # osrm-extract
    echo "[OSRM] Paso 1/3: osrm-extract (10-20 min)..."
    if osrm-extract -p /opt/osrm/profiles/car.lua "$OSM_FILE"; then
        echo "[OSRM] ✅ osrm-extract completado"
    else
        echo "[OSRM] ❌ osrm-extract falló"
        exit 1
    fi
    echo ""
    
    # osrm-partition
    echo "[OSRM] Paso 2/3: osrm-partition (2-5 min)..."
    if osrm-partition "$OSRM_FILE"; then
        echo "[OSRM] ✅ osrm-partition completado"
    else
        echo "[OSRM] ❌ osrm-partition falló"
        exit 1
    fi
    echo ""
    
    # osrm-customize
    echo "[OSRM] Paso 3/3: osrm-customize (5-10 min)..."
    if osrm-customize "$OSRM_FILE"; then
        echo "[OSRM] ✅ osrm-customize completado"
    else
        echo "[OSRM] ❌ osrm-customize falló"
        exit 1
    fi
    echo ""
    
    # ============================================================================
    # STEP 4: Validar archivos generados
    # ============================================================================
    echo "[OSRM] 📋 Validando archivos compilados..."
    
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
        if [ -f "$OSRM_DATA_DIR/$file" ]; then
            echo "[OSRM] ✅ $file"
        else
            echo "[OSRM] ❌ FALTA: $file"
            ALL_GOOD=false
        fi
    done
    
    if [ "$ALL_GOOD" = false ]; then
        echo "[OSRM] ❌ Algunos archivos no se compilaron correctamente"
        exit 1
    fi
    
    echo ""
    echo "[OSRM] ✅ Datos compilados exitosamente!"
    echo ""
fi

# ============================================================================
# STEP 5: Iniciar OSRM
# ============================================================================
echo "[OSRM] 🚀 Iniciando OSRM server..."
echo "[OSRM] Escuchando en 0.0.0.0:5000"
echo ""

# Ejecutar osrm-routed con el archivo compilado
exec osrm-routed --algorithm mld "$OSRM_FILE"
