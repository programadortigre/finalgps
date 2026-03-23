# Geocercas en Leaflet - Quick Reference

## 🎯 Resumen Rápido de Cambios

### 1️⃣ **Crear Geocerca (handleFinishDrawing)**

```diff
  const handleFinishDrawing = () => {
    if (tempPolygon.length < 3) {
        alert('El perímetro debe tener al menos 3 puntos.');
        return;
    }
    
+   // Convertir [lat, lng] a GeoJSON [lng, lat]
+   const coords = tempPolygon.map(p => [p[1], p[0]]);
+   
+   // Verificar si ya está cerrado
+   const isClosed = JSON.stringify(coords[0]) === JSON.stringify(coords[coords.length - 1]);
+   
+   // Cerrar el polígono si es necesario
+   const closedCoords = isClosed ? coords : [...coords, coords[0]];
+   
+   // Validación de polígono valid
+   if (closedCoords.length < 4) {
+       alert('El polígono debe tener al menos 3 puntos distintos.');
+       return;
+   }
    
    const geojson = {
        type: 'Polygon',
-       coordinates: [closedCoords.map(p => [p[1], p[0]])]
+       coordinates: [closedCoords]
    };
    
    onPolygonComplete(geojson);
    setTempPolygon([]);
  };
```

---

### 2️⃣ **Renderizar Geocercas Existentes**

```diff
  {customers.map(cust => {
-   if (!cust.geofence || !cust.geofence.coordinates || !cust.geofence.coordinates[0]) return null;
+   if (!cust.geofence?.coordinates?.[0]) return null;
    
    try {
-     const positions = cust.geofence.coordinates[0].map(c => [c[1], c[0]]);
+     const geoJsonRing = cust.geofence.coordinates[0];
+     
+     if (!Array.isArray(geoJsonRing) || geoJsonRing.length < 3) {
+         console.warn(`Geocerca inválida: ${cust.id}`);
+         return null;
+     }
+     
+     const positions = geoJsonRing.map(([lng, lat]) => [lat, lng]);
      
      let color = '#3b82f6';
      if (cust.visit_status === 'ongoing') color = '#f59e0b';
      if (cust.visit_status === 'completed') color = '#10b981';
      
      return (
        <Polygon 
          positions={positions}
          pathOptions={{
            color,
            fillColor: color,
            fillOpacity: 0.15,
            weight: 2,
            dashArray: '5, 5',
+           lineCap: 'round',
+           lineJoin: 'round'
          }}
        >
          <Popup>
            <div className="text-xs font-bold">{cust.name}</div>
            <div className="text-[10px] text-slate-500">Perímetro de visita</div>
+           <div className="text-[10px] text-slate-600 mt-1">
+               Puntos: {positions.length}
+           </div>
          </Popup>
        </Polygon>
      );
    } catch (e) {
-     console.error('Error rendering geofence for customer', cust.id, e);
+     console.error(`Error renderizando geocerca: ${cust.id}`, e);
      return null;
    }
  })}
```

---

### 3️⃣ **Preview del Polígono (isDrawingPerimeter)**

```diff
  {/* ── DRAWING POLYGON PREVIEW ── */}
  {isDrawingPerimeter && tempPolygon.length > 0 && (
    <>
-     <Polyline positions={tempPolygon} color="#6366f1" weight={3} dashArray="5, 10" />
+     <Polyline 
+       positions={tempPolygon} 
+       pathOptions={{
+         color: '#6366f1',
+         weight: 3,
+         dashArray: '5, 10',
+         lineCap: 'round',
+         lineJoin: 'round',
+         opacity: 0.8
+       }}
+     />
      
      {tempPolygon.map((p, i) => (
        <Marker 
          key={`temp-vertex-${i}`} 
          position={p} 
          interactive={false}
          icon={L.divIcon({
            className: '',
            html: `<div style="..."></div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5]
          })}
        />
      ))}
      
      {tempPolygon.length >= 3 && (
        <Polygon 
          positions={tempPolygon} 
+         pathOptions={{
+           color: '#6366f1',
+           fillColor: '#6366f1',
+           fillOpacity: 0.2,
+           weight: 2,
+           dashArray: '3, 3',
+           lineCap: 'round',
+           lineJoin: 'round'
+         }}
        />
      )}
    </>
  )}
```

---

## 📐 Datos: GeoJSON vs Leaflet

| Aspecto | GeoJSON | Leaflet |
|---------|---------|---------|
| **Orden de coordenadas** | `[lng, lat]` | `[lat, lng]` |
| **Polígono abierto** | ❌ No válido | ✅ Válido |
| **Polígono cerrado** | ✅ Requerido (primer punto = último) | ✅ Se cierra automáticamente |
| **Ejemplo** | `[[-77.45, 12.12]]` | `[[12.12, -77.45]]` |

---

## 🔍 Checklist de Validación

```javascript
// Antes de crear/guardar una geocerca, verificar:

const isValidGeofence = (geofence) => {
    // 1. Estructura básica
    if (geofence?.type !== 'Polygon') return false;
    if (!Array.isArray(geofence.coordinates?.[0])) return false;
    
    // 2. Mínimo de puntos
    const ring = geofence.coordinates[0];
    if (ring.length < 4) return false; // Al menos 3 + 1 para cerrar
    
    // 3. Polígono cerrado
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (JSON.stringify(first) !== JSON.stringify(last)) return false;
    
    // 4. Coordenadas válidas
    return ring.every(([lng, lat]) => 
        typeof lng === 'number' && typeof lat === 'number' &&
        lng >= -180 && lng <= 180 &&
        lat >= -90 && lat <= 90
    );
};
```

---

## 🛠️ Problemas Comunes

### ❌ Error: "Objeto no es un polígono válido"
```javascript
// Causa: Conversión de coordenadas invertida
const positions = coords.map(c => [c[0], c[1]]); // ❌ Incorrecto

// Solución: Desinvertir o usar destructuring
const positions = coords.map(([lng, lat]) => [lat, lng]); // ✅ Correcto
```

### ❌ Error: "No puedo crear polígono con X puntos"
```javascript
// Causa: Polígono sin cerrar (GeoJSON)
coordinates: [[p1, p2, p3]] // ❌ Incorrecto, falta cerrar

// Solución: El primer punto debe ser igual al último
coordinates: [[p1, p2, p3, p1]] // ✅ Correcto
```

### ❌ Error: "El popup aparece en lugar extraño"
```javascript
// Causa: Sin especificar interactivity
<Polygon positions={positions} /> // ❌ interactive=true por defecto

// Solución: Ser explícito si no quieres interactividad
<Polygon positions={positions} interactive={false} />
```

---

## 📊 Estructura de Base de Datos

```sql
-- Table: customers
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    geom GEOGRAPHY(Point, 4326) NOT NULL,           -- Centro/punto principal
    geofence GEOGRAPHY(Polygon, 4326),              -- Perímetro como polígono
    min_visit_minutes INTEGER DEFAULT 5,            -- Tiempo mínimo de visita
    ...
);

-- Índices para búsqueda rápida
CREATE INDEX idx_customers_geom ON customers USING GIST (geom);
CREATE INDEX idx_customers_geofence ON customers USING GIST (geofence);
```

---

## 📡 API - Ejemplo de Respuesta

```json
{
  "id": 1,
  "name": "Bodega Don Lucho",
  "lat": 12.123456,
  "lng": -77.456789,
  "geofence": {
    "type": "Polygon",
    "coordinates": [[
      [-77.456, 12.123],
      [-77.455, 12.125],
      [-77.457, 12.124],
      [-77.456, 12.123]
    ]]
  }
}
```

---

## 🎨 Opciones de Estilo Recomendadas

```javascript
// Polígono para zona de visita completada
const completedStyle = {
    color: '#10b981',        // Emerald
    fillColor: '#10b981',
    fillOpacity: 0.15,
    weight: 2,
    dashArray: '5, 5',
    lineCap: 'round',
    lineJoin: 'round'
};

// Polígono para zona de visita en progreso
const ongoingStyle = {
    color: '#f59e0b',        // Amber
    fillColor: '#f59e0b',
    fillOpacity: 0.2,
    weight: 3,               // Más notable
    dashArray: '5, 5',
    lineCap: 'round',
    lineJoin: 'round'
};

// Polígono para zona pendiente
const pendingStyle = {
    color: '#3b82f6',        // Blue
    fillColor: '#3b82f6',
    fillOpacity: 0.15,
    weight: 2,
    dashArray: '5, 5',
    lineCap: 'round',
    lineJoin: 'round'
};

// Preview durante dibujo
const drawingStyle = {
    color: '#6366f1',        // Indigo
    fillColor: '#6366f1',
    fillOpacity: 0.2,
    weight: 2,
    dashArray: '3, 3',
    lineCap: 'round',
    lineJoin: 'round',
    opacity: 0.8
};
```

---

## 🔗 Enlaces Útiles

- **Leaflet Polygon:** https://leafletjs.com/reference.html#polygon
- **GeoJSON Spec:** https://geojson.org/
- **PostGIS ST_GeogFromGeoJSON:** https://postgis.net/docs/ST_GeogFromGeoJSON.html
- **MDN Array.map:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map

---

**Última actualización:** 23 de marzo de 2026
