# ✅ Solución - Error ST_GeogFromGeoJSON

## Problema Identificado
```
Error: function st_geogfromgeojson(text) does not exist
```

**Causa:** PostGIS 3.3.4 no tiene la función `ST_GeogFromGeoJSON`. En su lugar, proporciona `ST_GeomFromGeoJSON` que devuelve `geometry`, que luego puede convertirse a `geography` con un casteo.

---

## Solución Aplicada

### ✅ Archivo: `api/src/routes/customers.js`

#### 1. POST /api/customers (Línea ~48)
```diff
- CASE WHEN $7::text IS NOT NULL THEN ST_GeogFromGeoJSON($7::text) ELSE NULL::geography END
+ CASE WHEN $7::text IS NOT NULL THEN ST_GeomFromGeoJSON($7::text)::geography ELSE NULL::geography END
```

#### 2. PUT /api/customers/:id (Línea ~114)
```diff
- geofence = CASE WHEN $${i}::text IS NOT NULL THEN ST_GeogFromGeoJSON($${i}::text) ELSE NULL::geography END
+ geofence = CASE WHEN $${i}::text IS NOT NULL THEN ST_GeomFromGeoJSON($${i}::text)::geography ELSE NULL::geography END
```

---

## Diferencia de Funciones en PostGIS

| Función | Entrada | Salida | Versión |
|---------|---------|--------|---------|
| `ST_GeomFromGeoJSON()` | GeoJSON text | `geometry` (2D) | 3.0+ ✅ Disponible |
| `ST_GeogFromGeoJSON()` | GeoJSON text | `geography` | 3.4+ ❌ No existe en 3.3.4 |

**Solución:** Usar `ST_GeomFromGeoJSON()` + casteo explicit: `::geography`

---

## Verificación en Base de Datos

```sql
-- Lo que existía:
SELECT proname FROM pg_proc WHERE proname LIKE '%geojson%';
-- Resultado: st_asgeojson, st_geomfromgeojson (✅)

-- Lo que NO existe:
SELECT proname FROM pg_proc WHERE proname = 'st_geogfromgeojson';
-- Resultado: (0 rows) ❌
```

---

## Cómo Probar la Solución

1. **Re-disparar el servidor API:**
   ```bash
   docker restart gps-api
   ```

2. **Ir al admin panel y dibujar una geocerca:**
   - Hacer clic en "Live" view
   - Modo "Área"
   - Dibujar un polígono (mín. 3 puntos)
   - Crear cliente con perímetro

3. **Esperado:** Se debe guardar sin error ✅

---

## Impacto

- ✅ Las inserciones de geocercas ahora funcionarán correctamente
- ✅ Las actualizaciones de geocercas ahora funcionarán correctamente
- ✅ La función `ST_AsGeoJSON(geofence)::json` sigue funcionando para lecturas

---

## PostGIS Versions Compatibility

- **PostGIS 3.0 - 3.3.4**: Usar `ST_GeomFromGeoJSON()::geography` ✅
- **PostGIS 3.4+**: Ambas funciones están disponibles (ST_GeomFromGeoJSON o ST_GeogFromGeoJSON)

---

## Archivos Modificados
- [api/src/routes/customers.js](../../api/src/routes/customers.js) (2 cambios)

**Status:** ✅ Completado y API reiniciado
