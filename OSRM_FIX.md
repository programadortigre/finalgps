# ⚡ FIX RÁPIDO: Error de OSRM Missing Files

## El Problema

```
[error] Required files are missing, cannot continue
[warn] Missing/Broken File: /data/peru-latest.osrm.*
```

Esto ocurre porque **faltan los datos precompilados de OSRM para Perú**.

---

## ✅ La Solución (3 pasos)

### Paso 1️⃣: Crear directorio y descargar datos

En tu **VM Ubuntu** (o WSL2):

```bash
cd ~/finalgps
mkdir -p osrm_data
cd osrm_data

# Descargar el archivo OSM de Perú (~350MB, toma 5-10 min)
wget https://download.geofabrik.de/south-america/peru-latest.osm.pbf
```

### Paso 2️⃣: Ejecutar script de compilación

```bash
cd ~/finalgps
bash setup-osrm.sh
```

Este script automáticamente:
- ✅ Verifica espacio en disco
- ✅ Compila los datos con Docker (20-40 min)
- ✅ Genera todos los archivos `.osrm.*` necesarios

### Paso 3️⃣: Reiniciar Docker

```bash
sudo docker-compose down
sudo docker-compose up -d --build

# Verifica que OSRM está corriendo
sudo docker-compose logs -f osrm
```

Espera a ver esta línea:
```
[info] starting service on: 0.0.0.0:5000
```

---

## ⏱️ Tiempo Total

- Descargar: 5-10 minutos
- Compilar: 20-40 minutos (según CPU/RAM de tu VM)
- Total: **~45-50 minutos**

---

## 🔍 Verificar que funciona

```bash
# Test rápido
curl http://localhost:5000/status
# Respuesta esperada: {"status":0}

# Ver estado de todos los contenedores
sudo docker-compose ps

# Deberías ver todos en "Up"
```

---

## ❓ Si algo falla

**Problema**: Docker se llena de memoria
```bash
# Libera espacio
docker system prune -a
# O añade más RAM a la VM
```

**Problema**: Descarga lenta
```bash
# Prueba con espejo alternativo
wget https://geofabrik.de/data/osm/south-america/peru/peru-latest.osm.pbf
```

**Problema**: Directorio no existe
```bash
# Crea manualmente
mkdir -p ~/finalgps/osrm_data
# Verifica permisos
chmod 755 ~/finalgps/osrm_data
```

---

## 📚 Documentación completa

Ver: [documentacion/OSRM_SETUP.md](OSRM_SETUP.md)

---

¡Eso es todo! El servicio OSRM debería estar funcionando después.
