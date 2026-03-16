# 🔧 Cambios realizados para solucionar error OSRM

## 📝 Resumen del problema

Se detectó que el servicio OSRM (Open Source Routing Machine) no podía iniciar por archivos faltantes:

```
[error] Required files are missing, cannot continue
[warn] Missing/Broken File: /data/peru-latest.osrm.*
```

**Causa root**: El directorio `osrm_data/` nunca se creó y no contenía los archivos precompilados de OSRM para Perú.

---

## 🛠️ Cambios realizados

### 1. Documentación de OSRM

**Archivo creado**: `documentacion/OSRM_SETUP.md`
- Guía completa con opciones para obtener datos de OSRM
- Instrucciones paso a paso para compilar con Docker
- Troubleshooting para problemas comunes
- Estimaciones de tiempo y espacio requerido

**Archivo creado**: `OSRM_FIX.md`
- **Referencia rápida** (para usuarios con prisa)
- 3 pasos simples para resolver el error
- Comandos listos para copiar y pegar

### 2. Script de automatización

**Archivo creado**: `setup-osrm.sh`
- Script Bash que automatiza todo el proceso
- Descarga datos de Geofabrik
- Ejecuta compilación con Docker
- Verifica archivos generados
- **Uso**: `bash setup-osrm.sh`

**Características**:
- ✅ Verifica espacio en disco (requiere ~3.5GB)
- ✅ Descarga peru-latest.osm.pbf (~350MB)
- ✅ Ejecuta osrm-extract (compilación)
- ✅ Ejecuta osrm-partition (indexado)
- ✅ Ejecuta osrm-customize (optimización)
- ✅ Valida todos los archivos generados

### 3. Actualización de .gitignore

**Archivo**: `.gitignore`

**Cambios**:
```diff
+ # OSRM Data (very large, compiled locally)
+ osrm_data/
+ *.osm.pbf
```

**Razón**: Los datos compilados de OSRM son ~1-3GB y deben compilarse localmente, no están versionados.

### 4. Actualización del README

**Archivo**: `README.md`

**Cambios**:
```diff
  ## 1. Prerequisites
  - Docker & Docker Compose
  - Flutter SDK (for mobile app)
  - Android Emulator or physical device
+ - **IMPORTANT**: [OSRM Map Data for Peru](OSRM_FIX.md) - Run `bash setup-osrm.sh` before deploying
```

**Razón**: Advierte a usuarios que deben ejecutar setup-osrm.sh antes de hacer deploy.

---

## 📋 Flujo de trabajo para usuarios

### Primera vez (desarrollo)

```bash
# 1. Clonar repo
git clone <repo>
cd finalgps

# 2. ⚠️ IMPORTANTE: Setup OSRM (nuevo paso)
bash setup-osrm.sh

# 3. Deploy
docker-compose up -d --build
```

### Producción (VM Ubuntu)

```bash
# 1. Clone en VM
cd ~/finalgps
git pull

# 2. ⚠️ IMPORTANTE: Setup OSRM
bash setup-osrm.sh

# 3. Deploy
sudo docker-compose up -d --build

# 4. Verificar
sudo docker-compose ps
```

---

## 🔍 Archivos generados por setup-osrm.sh

Después de ejecutar el script, se crea esta estructura:

```
finalgps/
├── osrm_data/
│   ├── peru-latest.osm.pbf                           (~350MB)
│   ├── peru-latest.osrm                              (~1GB)
│   ├── peru-latest.osrm.edges                        ✓ requerido
│   ├── peru-latest.osrm.ramIndex                     ✓ requerido
│   ├── peru-latest.osrm.fileIndex                    ✓ requerido
│   ├── peru-latest.osrm.geometry                     ✓ requerido
│   ├── peru-latest.osrm.names                        ✓ requerido
│   ├── peru-latest.osrm.datasource_names             ✓ requerido
│   ├── peru-latest.osrm.icd                          ✓ requerido
│   ├── peru-latest.osrm.maneuver_overrides           ✓ requerido
│   ├── peru-latest.osrm.turn_weight_penalties        ✓ requerido
│   ├── peru-latest.osrm.turn_duration_penalties      ✓ requerido
│   └── peru-latest.osrm.timestamp                    ✓ requerido
└── .gitignore (actualizado, ignora osrm_data/)
```

---

## ✅ Verificación post-fix

Una vez ejecutado `setup-osrm.sh` y `docker-compose up -d`:

```bash
# 1. Ver logs de OSRM
sudo docker-compose logs osrm | tail -20

# Esperado:
# [info] starting service on: 0.0.0.0:5000
# [info] Service running

# 2. Test del endpoint
curl http://localhost:5000/status

# Esperado: {"status":0}

# 3. Verificar que worker usa OSRM
sudo docker-compose logs worker | grep -i osrm

# Esperado ver: OSRM_URL=http://osrm:5000
```

---

## 🚀 Impacto

### Antes del fix:
- ❌ Servicio OSRM no inicia
- ❌ Worker no puede hacer map matching
- ❌ GPS puntos no se alinean con carreteras

### Después del fix:
- ✅ OSRM inicia correctamente
- ✅ Worker puede procesar map matching
- ✅ GPS puntos alineados con carreteras reales
- ✅ Rutas y distancias más precisas

---

## 📝 Notas técnicas

### Por qué OSRM es necesario

El servicio OSRM se usa en `worker/src/osrmService.js`:

```javascript
// Ajusta puntos GPS a rutas reales (map matching)
async function matchSegment(points) {
    const url = `${OSRM_URL}/match/v1/driving/${coords}?...`;
    const response = await axios.get(url);
    return response.data;
}
```

Sin OSRM compilado, el worker no puede:
- Alinear puntos GPS a carreteras
- Calcular distancias reales
- Procesar rutas correctamente

### Tiempo de compilación esperado

| Paso | Tiempo |
|------|--------|
| Descargar OSM | 5-10 min |
| osrm-extract | 10-20 min |
| osrm-partition | 2-5 min |
| osrm-customize | 5-10 min |
| **Total** | **25-45 min** |

(Depende de CPU/RAM disponible)

### Espacio requerido

- Datos OSM (pbf): ~350MB
- **Datos compilados**: ~2-3GB
- **Total**: ~3.5GB mínimo

---

## 🔗 Referencias

- 📚 OSRM Documentación: https://docs.project-osrm.org/
- 📥 Datos Geofabrik: https://download.geofabrik.de/south-america/peru.html
- 🐳 Docker OSRM: https://hub.docker.com/r/osrm/osrm-backend
- 🔧 Profiles OSRM: https://github.com/Project-OSRM/osrm-backend/tree/master/profiles

---

## 💡 Mejoras futuras

Opciones para optimizar:

1. **Cachear datos compilados**: Guardar en S3/Cloud Storage para reutilizar
2. **Pre-compilar en CI/CD**: Compilar durante build, no en runtime
3. **Datos incrementales**: Actualizar solo cambios regionales
4. **Alternativas a OSRM**: Considerar Vroom, Graphhopper si performance mejora
