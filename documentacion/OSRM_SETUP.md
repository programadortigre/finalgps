# 🗺️ Configuración de OSRM - Datos de Perú

## ¿Qué es OSRM y por qué lo necesitas?

**OSRM** (Open Source Routing Machine) es el servicio que:
- ✅ Ajusta los puntos GPS a las carreteras reales
- ✅ Procesa "map matching" para mejorar la precisión
- ✅ Calcula rutas y distancias exactas

Sin los datos de OSRM precompilados, recibimos este error:
```
[error] Required files are missing, cannot continue
[warn] Missing/Broken File: /data/peru-latest.osrm.*
```

---

## 🚀 Solución Rápida (Opción Recomendada)

### PASO 1: Descargar datos precompilados

Ejecuta en tu VM Linux:

```bash
cd ~/finalgps
mkdir -p osrm_data
cd osrm_data

# Descargar el archivo de datos de Perú (≈ 350MB)
wget https://download.geofabrik.de/south-america/peru-latest.osm.pbf

# El archivo debe estar en: ~/finalgps/osrm_data/peru-latest.osm.pbf
```

### PASO 2: Compilar los datos con OSRM

Docker se encargará automáticamente en el siguiente paso. **PERO PRIMERO**, si necesitas compilar localmente:

```bash
# Opción A: Usar imagen Docker para compilar (recomendado, ≈ 10-15 minutos)
docker run -t -v /home/ubuntu/finalgps/osrm_data:/data osrm/osrm-backend \
  osrm-extract -p /opt/osrm/profiles/car.lua /data/peru-latest.osm.pbf

docker run -t -v /home/ubuntu/finalgps/osrm_data:/data osrm/osrm-backend \
  osrm-partition /data/peru-latest.osrm

docker run -t -v /home/ubuntu/finalgps/osrm_data:/data osrm/osrm-backend \
  osrm-customize /data/peru-latest.osrm
```

### PASO 3: Iniciar los contenedores

```bash
sudo docker-compose up -d --build

# Verificar que osrm está corriendo
sudo docker-compose logs osrm
```

Deberías ver:
```
[info] LibOSRM initialized using algorithm: MLD
[info] starting service on: 0.0.0.0:5000
```

---

## 💾 Opción B: Descargar datos precompilados (MÁS RÁPIDO)

Si alguien ya compiló los datos, puedes obtenerlos directamente:

### Desde repositorios comunitarios:

```bash
cd ~/finalgps/osrm_data

# Opción 1: Desde OpenStreetMap (si existen datos precompilados)
# wget https://some-osrm-host/peru-latest.osrm.tar.gz
# tar -xzf peru-latest.osrm.tar.gz

# O contacta al equipo para obtener los datos compilados
```

### Archivos necesarios en osrm_data/:

Después de compilar, debes tener estos archivos (≥ 2-3 GB total):

```
osrm_data/
├── peru-latest.osm.pbf           (≈ 350MB) - OSM fuente
├── peru-latest.osrm              (≈ 1GB) - Archivo base compilado
├── peru-latest.osrm.edges        (requerido)
├── peru-latest.osrm.ramIndex     (requerido)
├── peru-latest.osrm.fileIndex    (requerido)
├── peru-latest.osrm.geometry     (requerido)
├── peru-latest.osrm.names        (requerido)
├── peru-latest.osrm.datasource_names (requerido)
├── peru-latest.osrm.icd          (requerido)
├── peru-latest.osrm.maneuver_overrides (requerido)
├── peru-latest.osrm.turn_weight_penalties (requerido)
├── peru-latest.osrm.turn_duration_penalties (requerido)
└── peru-latest.osrm.timestamp    (requerido)
```

---

## 🔧 Troubleshooting

### Problema: Docker no encuentra los datos

**Síntoma:**
```
[error] Required files are missing, cannot continue
```

**Solución:**
```bash
# 1. Verifica que el directorio existe
ls -la ~/finalgps/osrm_data

# 2. Verifica que el archivo .pbf existe
ls -la ~/finalgps/osrm_data/peru-latest.osm.pbf

# 3. Si no existe, descárgalo
wget -O ~/finalgps/osrm_data/peru-latest.osm.pbf \
  https://download.geofabrik.de/south-america/peru-latest.osm.pbf

# 4. Reinicia Docker
sudo docker-compose restart osrm
```

### Problema: Compilación tarda mucho

**Síntoma:** El contenedor osrm está corriendo pero no responde

**Solución:**
```bash
# Ver progreso
sudo docker-compose logs -f osrm

# Si tarda más de 30 minutos, puede ser normal en VMs pequeñas
# Paciencia... ¡es un archivo grande!
```

### Problema: Error de memoria durante compilación

**Síntoma:**
```
Out of memory / Killed
```

**Solución:**
- Añade más RAM a tu VM (mínimo 4GB recomendado)
- O usa esta opción más eficiente:

```bash
docker run -t -v /home/ubuntu/finalgps/osrm_data:/data osrm/osrm-backend \
  osrm-extract -p /opt/osrm/profiles/car.lua /data/peru-latest.osm.pbf \
  --memory-limit 2000
```

---

## 📊 Tiempo esperado

| Operación | Tiempo |
|-----------|--------|
| Descargar peru-latest.osm.pbf | 5-10 min |
| **osrm-extract** | 10-20 min |
| **osrm-partition** | 2-5 min |
| **osrm-customize** | 5-10 min |
| **TOTAL** | **25-45 min** |

(Depende de CPU/RAM de tu VM)

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

# 3. Crear directorio limpio
mkdir -p ~/finalgps/osrm_data

# 4. Descargar datos frescos
wget -O ~/finalgps/osrm_data/peru-latest.osm.pbf \
  https://download.geofabrik.de/south-america/peru-latest.osm.pbf

# 5. Reiniciar con compilación
sudo docker-compose up -d --build

# 6. Ver progreso (esto tardará...)
sudo docker-compose logs -f osrm
```

---

## Links útiles

- 📥 **Datos OSM**: https://download.geofabrik.de/south-america/peru.html
- 📚 **OSRM Docs**: https://docs.project-osrm.org/
- 🐳 **Docker OSRM**: https://hub.docker.com/r/osrm/osrm-backend
- 🔧 **Perfiles OSRM**: https://github.com/Project-OSRM/osrm-backend/tree/master/profiles

---

## Next Steps

Una vez que OSRM esté funcionando:

1. ✅ El servicio worker podrá procesar "map matching"
2. ✅ GPS puntos se ajustarán a carreteras reales
3. ✅ Las consultas de ruta funcionarán correctamente
