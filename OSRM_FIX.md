# ⚡ FIX RÁPIDO: Error de OSRM Missing Files

## El Problema

```
[error] Required files are missing, cannot continue
[warn] Missing/Broken File: /data/peru-latest.osrm.*
```

Esto ocurría porque **faltaban los datos precompilados de OSRM para Perú**.

**✅ AHORA ESTÁ COMPLETAMENTE AUTOMATIZADO**

---

## ✅ La Solución (1 solo paso)

### Paso Único: Iniciar Docker

```bash
sudo docker-compose down
sudo docker-compose up -d --build
```

Eso es todo. El contenedor OSRM automáticamente:
- ✅ Verifica si hay datos compilados
- ✅ Si no existen, descarga datos de Perú (~350MB)
- ✅ Compila con Docker (20-40 min, solo la primera vez)
- ✅ Inicia el servicio OSRM

---

## ⏱️ Tiempo Total

**Primera vez**: ~50 minutos (descarga + compilación)
- Descargar: 5-10 minutos
- Compilar: 20-40 minutos (según CPU/RAM de tu VM)

**Siguientes veces**: ~2 segundos (datos ya compilados)

---

## 🔍 Verificar que funciona

```bash
# Ver logs de OSRM
sudo docker-compose logs -f osrm

# Espera a ver esta línea (indica que está listo):
# [OSRM] 🚀 Iniciando OSRM server...
# [OSRM] Escuchando en 0.0.0.0:5000
```

En otra terminal:
```bash
# Test rápido
curl http://localhost:5000/status

# Respuesta esperada: {"status":0}

# Ver estado de todos los contenedores
sudo docker-compose ps

# Todos deberían estar en "Up"
```

---

## ❓ Si algo falla

**Problema**: Docker se llena de memoria
```bash
# Libera espacio y reinicia
docker system prune -a
sudo docker-compose down
sudo docker-compose up -d --build
```

**Problema**: Descarga lenta o timeout
```bash
# El contenedor reintentar 3 veces automáticamente
# Si aún falla, verifica tu conexión:
sudo docker-compose logs osrm | tail -50
```

**Problema**: Quieres usar datos precompilados existentes
```bash
# Copia los archivos manualmente a osrm_data/
# El entrypoint detectará que existen y no compilará de nuevo
cp -r /ruta/a/datos/compilados/* ./osrm_data/
sudo docker-compose restart osrm
```

---

## 📚 Documentación completa

Ver: [documentacion/OSRM_SETUP.md](documentacion/OSRM_SETUP.md)

---

¡Eso es todo! OSRM está completamente automatizado.

