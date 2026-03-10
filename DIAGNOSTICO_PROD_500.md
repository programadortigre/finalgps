# 🔴 DIAGNÓSTICO: Error 500 en Producción - trip_routes Faltante

## Problema Encontrado

**Error en logs:**
```
[ERROR] Failed to get trip 4: relation "trip_routes" does not exist
[ERROR] Failed to get trip 5: relation "trip_routes" does not exist
```

**Causa:** La tabla `trip_routes` NO EXISTE en la BD de producción.

## ¿Por qué sucedió?

En el setup inicial:
1. ✅ Se creó en desarrollo local
2. ❌ NO se ejecutó en producción
3. El código intenta hacer `SELECT FROM trip_routes` cuando se llama a `?simplify=true`
4. Si la tabla no existe → Error SQL → 500 Internal Server Error

## Solución 2 Pasos

### PASO 1: Crear tabla en Producción (5 minutos)

En tu servidor (`ubuntu@192.168.0.106`):

```bash
cd /home/ubuntu/finalgps

# Copiar archivo SQL al servidor
scp setup_prod_trip_routes.sql ubuntu@192.168.0.106:/tmp/

# Conectarse y ejecutar
ssh ubuntu@192.168.0.106
cd finalgps
docker exec -i gps-postgres psql -U postgres -d tracking < /tmp/setup_prod_trip_routes.sql
```

**Resultado esperado:**
```
 object       | count
──────────────┼───────
 trip_routes  |     0
 indices      |     5
...
✅ Setup completado!
```

### PASO 2: Actualizar API (2 minutos)

El código ya ha sido actualizado con:

1. **Rate-limit fix:**
   - Agregué `trustProxy: true` para trabajar con nginx/proxies
   - Esto evita el error: `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`

2. **trip_routes table check:**
   - Ahora soporta si la tabla NO existe
   - Si falta la tabla → Fallback automático a `locations`
   - Nunca más 500 Error

3. **Better error handling:**
   - Maneja errores SQL de tabla no existente
   - Valida GeoJSON antes de procesarlo
   - 3 capas de fallback

**En tu servidor, actualizar código:**
```bash
cd /home/ubuntu/finalgps
git pull origin main
docker-compose restart gps-api
```

---

## Verificar que Funcionó

### Option 1: Desde el panel admin

1. Login con: `yordi@gmail.com / yordi123`
2. Ir a "Historial"
3. Hacer click en un viaje
4. Debe cargar sin error 500 ✅

### Option 2: Test directo con curl

```bash
# Generar token (reemplaza con tu admin password)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"yordi@gmail.com","password":"yordi123"}'

# Copiar el accessToken de la respuesta
# Luego test:
curl http://localhost:3000/api/trips/4?simplify=true \
  -H "Authorization: Bearer YOUR_TOKEN"

# Debe retornar JSON con puntos, no 500
```

---

## Checklist

- [ ] Ejecuté `setup_prod_trip_routes.sql` en BD
- [ ] Confirmé que `trip_routes` table existe (5 índices creados)
- [ ] Hice `git pull origin main` en servidor
- [ ] Reinicié API: `docker-compose restart gps-api`
- [ ] Testeé: Login → Historial → Click en viaje → ¡Sin error 500!

---

## Archivos Actualizados

1. **api/src/routes/trips.js**
   - Agregué try-catch para capturar error de tabla no existente
   - Manejo graceful: Si tabla falta → usa locations como fallback
   - Nunca retorna 500 por tabla faltante

2. **api/src/server.js**
   - Agregué `trustProxy: true` en rate limiters
   - Esto arregla el error: `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`
   - Funciona correctamente detrás de nginx/proxies

3. **setup_prod_trip_routes.sql (NUEVO)**
   - Script SQL puro para crear table
   - Crea índices automáticamente
   - `CREATE TABLE IF NOT EXISTS` → seguro ejecutar múltiples veces

---

## Logs Esperados Después

```
[API] Trip 4: returned 15 points (full ❌)
[WARNING] Trip 4: No simplified route found, using full route
```

(Dice "full" porque `trip_routes` estará vacío, pero eso es OK - ya no 500!)

---

## Próximo Paso: Compilar Rutas Automáticamente

Una vez que `trip_routes` exista, el worker debería:
- Procesar viajes cerrados
- Usar ST_SimplifyPreserveTopology
- Compilar rutas simplificadas

**En worker logs deberías ver:**
```
[SIMPLIFY] Trip X: compiled 1920 points → 115 simplified (94% reduction)
```

Si no ves eso, significa que el worker aún no está compilando. Podemos revisar eso después.

---

## Status

🔴 **Problema Identificado:** trip_routes faltante en producción  
🟡 **Código Actualizado:** API ahora soporta tabla faltante  
🟢 **Solución:** Ejecutar setup_prod_trip_routes.sql + git pull + restart

**Tiempo total:** 10 minutos  
**Impacto:** Error 500 desaparecerá, historial funcionará ✅

