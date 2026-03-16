# 🗺️ Configuración de OSRM - Datos de Perú

## ¿Qué es OSRM y por qué lo necesitas?

**OSRM** (Open Source Routing Machine) es el servicio que:
- ✅ Ajusta los puntos GPS a las carreteras reales
- ✅ Procesa "map matching" para mejorar la precisión
- ✅ Calcula rutas y distancias exactas

---

## 🚀 OPCIÓN RECOMENDADA: Automático

**✨ AHORA ESTÁ TOTALMENTE AUTOMATIZADO**

Solo necesitas:

```bash
cd ~/finalgps
sudo docker-compose up -d --build
```

El contenedor OSRM automáticamente:
- ✅ Detecta si hay datos compilados
- ✅ Si no existen, descarga peru-latest.osm.pbf (~350MB)
- ✅ Compila con Docker (20-40 minutos)
- ✅ Inicia el servicio

**Tiempo la primera vez**: ~50 minutos
**Tiempo siguientes**: ~2 segundos (datos ya compilados)

### Ver progreso:

```bash
sudo docker-compose logs -f osrm
```

Esperado ver:
```
[OSRM] ⬇️  Descargando peru-latest.osm.pbf...
[OSRM] 🔧 Compilando datos de OSRM...
[OSRM] 🚀 Iniciando OSRM server...
[OSRM] Escuchando en 0.0.0.0:5000
```

---

## 🔧 OPCIÓN MANUAL: Pre-descargar datos

Si prefieres descargar y compilar **antes** de iniciar Docker:

### PASO 1: Descargar datos

```bash
cd ~/finalgps
mkdir -p osrm_data
cd osrm_data

# Descargar el archivo de datos de Perú (≈ 350MB)
wget https://download.geofabrik.de/south-america/peru-latest.osm.pbf
```

### PASO 2: Compilar (opcional, se hace automáticamente si no existen)

```bash
# Si quieres compilar ahora en vez de esperar al docker-compose up:
bash ../setup-osrm.sh
```

### PASO 3: Iniciar Docker

```bash
cd ~/finalgps
sudo docker-compose up -d --build
```

---

## 💾 Archivos necesarios

Después de compilación, debes tener (~2-3 GB total):

```
osrm_data/
├── peru-latest.osm.pbf           (~350MB)
├── peru-latest.osrm              (~1GB)
├── peru-latest.osrm.edges        ✓
├── peru-latest.osrm.ramIndex     ✓
├── peru-latest.osrm.fileIndex    ✓
├── peru-latest.osrm.geometry     ✓
├── peru-latest.osrm.names        ✓
├── peru-latest.osrm.datasource_names ✓
├── peru-latest.osrm.icd          ✓
├── peru-latest.osrm.maneuver_overrides ✓
├── peru-latest.osrm.turn_weight_penalties ✓
├── peru-latest.osrm.turn_duration_penalties ✓
└── peru-latest.osrm.timestamp    ✓
```

---

## 🔧 Troubleshooting

### Problema: compilación tarda mucho

**Síntoma**: El contenedor osrm está corriendo pero no responde

**Solución**:
```bash
# Ver progreso 
sudo docker-compose logs -f osrm

# Es normal que tarde 20-40 minutos la primera vez
# La compilación usa mucho CPU
```

### Problema: Error de memoria durante compilación

**Síntoma**:
```
Out of memory / Killed
```

**Solución**:
- Añade más RAM a tu VM (mínimo 4GB recomendado)
- Para liberar espacio:
```bash
docker system prune -a
# Luego reinicia
sudo docker-compose down
sudo docker-compose up -d --build
```

### Problema: Descarga falla

**Síntoma**:
```
[OSRM] ❌ Descarga fallida después de 3 intentos
```

**Solución**:
- El contenedor reintenta 3 veces automáticamente
- Verifica tu conexión a Internet
- Si persiste, descarga manualmente antes:

```bash
wget -O osrm_data/peru-latest.osm.pbf \
  https://download.geofabrik.de/south-america/peru-latest.osm.pbf
```

### Problema: Quiero usar datos precompilados de otra fuente

```bash
# Copia tus datos a osrm_data/
cp /ruta/datos/compilados/* ./osrm_data/

# El contenedor detectará que existen
sudo docker-compose up -d --build
# No compilará de nuevo
```

---

## 📊 Tiempo esperado

| Operación | Tiempo |
|-----------|--------|
| Descargar osm.pbf | 5-10 min |
| **osrm-extract** | 10-20 min |
| **osrm-partition** | 2-5 min |
| **osrm-customize** | 5-10 min |
| **TOTAL (1ª vez)** | **25-45 min** |

(Depende de CPU/RAM disponible)

---

## ✅ Verificar que funciona

```bash
# 1. Ver logs de OSRM
sudo docker-compose logs osrm | tail -20

# 2. Probar endpoint de OSRM
curl -X GET "http://localhost:5000/status"
# Respuesta esperada: {"status":0}

# 3. Ver si worker está conectado
sudo docker-compose logs worker | grep -i osrm
# Deberías ver: "OSRM_URL=http://osrm:5000"

# 4. Verificar que todos los contenedores están Up
sudo docker-compose ps
```

Salida esperada:
```
NAME                STATUS
gps-postgres        Up 2 minutes
gps-redis           Up 2 minutes
gps-api             Up (healthy)
gps-worker          Up
gps-osrm            Up  ✅ ESTO DEBE ESTAR CORRIENDO
gps-admin           Up
```

---

## 🚨 Si necesitas empezar de cero

```bash
# 1. Detener servicios
sudo docker-compose down

# 2. Limpiar datos viejos
sudo rm -rf ~/finalgps/osrm_data/*

# 3. Reiniciar (descargará y compilará de nuevo)
sudo docker-compose up -d --build

# 4. Ver progreso
sudo docker-compose logs -f osrm
```

---

## Links útiles

- 📥 **Datos OSM**: https://download.geofabrik.de/south-america/peru.html
- 📚 **OSRM Docs**: https://docs.project-osrm.org/
- 🐳 **Docker OSRM**: https://hub.docker.com/r/osrm/osrm-backend
- 🔧 **Perfiles OSRM**: https://github.com/Project-OSRM/osrm-backend/tree/master/profiles
