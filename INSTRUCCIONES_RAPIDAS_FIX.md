# 🎯 INSTRUCCIONES RÁPIDAS PARA ARREGLAR ERROR 500 EN PRODUCCIÓN

## Causa del Problema
La tabla `trip_routes` NO EXISTE en tu servidor de producción. Sin esta tabla, el endpoint `/api/trips/:id?simplify=true` retorna 500.

---

## Solución Rápida (5 minutos)

### PASO 1: Conectar a tu servidor

```bash
ssh ubuntu@192.168.0.106
# Password: ubuntu23131510@
```

### PASO 2: Entrar al directorio

```bash
cd finalgps
```

### PASO 3: Crear tabla trip_routes

**OPCIÓN A: Ejecutar comando directo (UNA LÍNEA)**

```bash
docker exec -i gps-postgres psql -U postgres -d tracking -c "
CREATE TABLE IF NOT EXISTS trip_routes (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER UNIQUE NOT NULL REFERENCES trips(id),
    geom_full GEOGRAPHY(LineString) NOT NULL,
    geom_simplified GEOGRAPHY(LineString) NOT NULL,
    point_count_full INTEGER,
    point_count_simplified INTEGER,
    tolerance_meters FLOAT DEFAULT 5,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_routes_trip_id ON trip_routes(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_routes_created_at ON trip_routes(created_at);
CREATE INDEX IF NOT EXISTS idx_trip_routes_geom_full ON trip_routes USING GIST(geom_full);
CREATE INDEX IF NOT EXISTS idx_trip_routes_geom_simplified ON trip_routes USING GIST(geom_simplified);
CREATE INDEX IF NOT EXISTS idx_locations_created_brin ON locations USING BRIN(created_at);

SELECT 'Tabla creada! ✅' as status;
"
```

**OPCIÓN B: Copiar archivo SQL (MÁS FÁCIL)**

```bash
# Descargar archivo (desde tu PC)
curl -o setup_prod.sql https://raw.githubusercontent.com/programadortigre/finalgps/main/setup_prod_trip_routes.sql

# Copiar al servidor
scp setup_prod.sql ubuntu@192.168.0.106:/tmp/

# En el servidor, ejecutar
docker exec -i gps-postgres psql -U postgres -d tracking < /tmp/setup_prod.sql
```

### PASO 3: Ver el resultado

```bash
docker exec gps-postgres psql -U postgres -d tracking -c "
SELECT 'trip_routes' as object, COUNT(*) FROM trip_routes
UNION ALL
SELECT 'índices', COUNT(*) FROM pg_indexes WHERE tablename='trip_routes';
"
```

**Esperado:**
```
    object    | count
──────────────┼───────
 trip_routes  |     0
 índices      |     5
```

### PASO 4: Actualizar código del API

```bash
cd finalgps
git pull origin main
docker-compose restart gps-api
```

### PASO 5: Verificar logs

```bash
docker logs gps-api --tail=20
```

Deberías ver:
```
[14:49:55.768] INFO (18): Server listening on 0.0.0.0:3000
```

Sin errores de `trip_routes does not exist` ✅

---

## Testing Post-Fix

1. **Login con admin:**
   - Email: `yordi@gmail.com`
   - Password: `yordi123`

2. **Ir a Historial**

3. **Click en un viaje**

4. **Debe cargar SIN error 500** ✅

---

## Si aún falla

Ver logs del API:
```bash
docker logs gps-api --tail=100 | grep ERROR
```

Si ves:
```
relation "trip_routes" does not exist
```

→ significa que el SQL no se ejecutó correctamente. Reintenta PASO 3.

---

## Qué cambió en el código

1. **api/src/routes/trips.js**
   - Ahora soporta si `trip_routes` no existe
   - Fallback automático a tabla `locations`

2. **api/src/server.js**
   - Arreglé error de `X-Forwarded-For` con nginx
   - Agregué `trustProxy: true`

---

## Status

✅ Código actualizado: git push completado  
⏳ Espera a tu ejecución del setup SQL  
✅ Después: git pull + docker restart  
🎉 Error 500 desaparecerá

**Tiempo aproximado:** 5-10 minutos

Déjame saber cuando termines y testeamos juntos! 🚀
