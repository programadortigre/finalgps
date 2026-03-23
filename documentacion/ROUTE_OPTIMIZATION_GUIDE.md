# 🚀 IMPLEMENTACIÓN DE RUTAS OPTIMIZADAS PARA VENDEDORES

## 📋 Índice
1. [Concepto](#concepto)
2. [Arquitectura](#arquitectura)
3. [Backend API](#backend-api)
4. [Base de Datos](#base-de-datos)
5. [Frontend (Admin Panel)](#frontend-admin-panel)
6. [Mobile (Flutter)](#mobile-flutter)
7. [Ejemplos Prácticos](#ejemplos-prácticos)

---

## 🎯 Concepto

**Flujo de Rutas Optimizadas**:

```
┌─────────────────────────────────────────────────────────────┐
│ ADMIN: Selecciona vendedor + clientes para hoy              │
└────────────────┬────────────────────────────────────────────┘
                 │ POST /api/routes/optimize
                 │ Body: {vendedores, clientes, fecha}
                 ▼
        ┌────────────────────┐
        │ OSRM Service       │
        │ Calcula orden      │
        │ optimizado de      │
        │ clientes (TSP)     │
        └────────────────────┘
                 │
                 │ Respuesta: Ruta con orden optimizado
                 ▼
        ┌────────────────────┐
        │ Guardar en BD:     │
        │ - routes.id        │
        │ - route_customers  │
        │ - route_assignments│
        └────────────────────┘
                 │
                 │ GET /api/routes/me/route (Vendedor)
                 ▼
        ┌────────────────────┐
        │ MOBILE (Flutter)   │
        │ Muestra ruta con   │
        │ clientes en orden  │
        └────────────────────┘
```

---

## 🏗️ Arquitectura

### 1. **Backend API** (`api/src/routes/routes.js`)
- ✅ `/api/routes/optimize` → Calcula ruta óptima
- ✅ `/api/routes/create` → Guarda ruta en BD
- ✅ `/api/routes/assign` → Asigna ruta a vendedor para fecha
- ✅ `/api/routes/me/route` → Obtiene ruta del vendedor hoy
- ✅ `/api/routes/:id/update-status` → Marca cliente como visitado

### 2. **OSRM Service** (`api/src/services/osrmService.js`)
- Cálculo de distancia entre clientes
- Matrix de distancias (OSRM `/table`)
- Optimización TSP (Traveling Salesman Problem)

### 3. **Base de Datos**
```sql
-- Rutas (órdenes de clientes)
CREATE TABLE routes (
    id SERIAL PRIMARY KEY,
    name VARCHAR,
    optimized_json_cache JSON, -- Puntos geom de la ruta
    total_distance FLOAT,
    total_time FLOAT,
    created_at TIMESTAMP
);

-- Clientes dentro de cada ruta
CREATE TABLE route_customers (
    id SERIAL PRIMARY KEY,
    route_id INT REFERENCES routes(id),
    customer_id INT REFERENCES customers(id),
    sort_order INT,  -- Orden de visita (1, 2, 3...)
    UNIQUE(route_id, customer_id)
);

-- Asignación de ruta a vendedor
CREATE TABLE route_assignments (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id),
    route_id INT REFERENCES routes(id),
    date DATE,
    status VARCHAR,  -- 'active', 'completed', 'cancelled'
    UNIQUE(employee_id, date)
);
```

### 4. **Frontend (Admin Panel)**
- UI para seleccionar vendedor + clientes
- Botón "Optimizar Ruta"
- Visualización de ruta en mapa
- Asignación a empleado

---

## 💾 Base de Datos

### Crear Tablas

```sql
-- ✅ YA EXISTEN en database/init.sql (verificar)
-- Si NO existen, correr estos scripts:

CREATE TABLE routes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    description TEXT,
    total_distance_meters FLOAT DEFAULT 0,
    total_time_seconds FLOAT DEFAULT 0,
    optimized_json_cache JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE route_customers (
    id SERIAL PRIMARY KEY,
    route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    UNIQUE(route_id, customer_id),
    INDEX route_id_sort (route_id, sort_order)
);

CREATE TABLE route_assignments (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'assigned',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, date)
);

CREATE TABLE route_stops (
    id SERIAL PRIMARY KEY,
    route_assignment_id INTEGER REFERENCES route_assignments(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id),
    arrived_at TIMESTAMP,
    left_at TIMESTAMP,
    duration_minutes FLOAT,
    notes TEXT
);
```

---

## 🔧 Backend API

### 1. OSRM Service para Optimización

**Archivo**: `api/src/services/osrmService.js`

```javascript
// ============================================================================
// FUNCIÓN: Obtener matriz de distancias desde OSRM
// Entrada: array de puntos [{lat, lng}]
// Salida: matriz de distancias entre todos los puntos
// ============================================================================
async function getDistanceMatrix(locations) {
    if (locations.length < 2) return null;
    
    const coords = locations
        .map(loc => `${loc.lng},${loc.lat}`)
        .join(';');
    
    const url = `${OSRM_URL}/table/v1/driving/${coords}?annotations=distance,duration`;
    
    try {
        const response = await axios.get(url, { timeout: 30000 });
        if (response.data.code === 'Ok') {
            return {
                distances: response.data.distances,
                durations: response.data.durations
            };
        }
        return null;
    } catch (error) {
        console.error('[OSRM] Error getting distance matrix:', error.message);
        return null;
    }
}

// ============================================================================
// FUNCIÓN: Optimizar orden de clientes (TSP - Traveling Salesman Problem)
// Entrada: Array de clientes con lat/lng
// Salida: Clientes en orden óptimo + distancia total + tiempo total
// Algorithm: Nearest Neighbor (simple pero efectivo)
// ============================================================================
async function optimizeRoute(customers, startingPoint = null) {
    if (customers.length === 0) return null;
    
    // Preparar puntos para matriz de distancias
    const locations = [];
    
    if (startingPoint) {
        locations.push(startingPoint); // Punto de inicio (ej: almacén)
    }
    
    locations.push(...customers);
    
    // Obtener matriz de distancias
    const matrix = await getDistanceMatrix(locations);
    if (!matrix) throw new Error('Failed to get distance matrix from OSRM');
    
    // ─────────────────────────────────────────────
    // Algorithm: Nearest Neighbor (Greedy)
    // ─────────────────────────────────────────────
    // 1. Empezar en punto inicial
    // 2. Siempre ir al cliente más cercano no visitado
    // 3. Repetir hasta visitar todos
    // Complejidad: O(n²) - rápido para n < 1000
    
    const visited = new Set();
    const route = [];
    let currentIdx = startingPoint ? 0 : -1;  // Si hay inicio, empezar ahí
    let totalDistance = 0;
    let totalTime = 0;
    
    // Si no hay punto de inicio, empezar con el primer cliente
    if (!startingPoint) {
        route.push({
            customer: customers[0],
            index: 0
        });
        visited.add(0);
        currentIdx = 0;
    } else {
        visited.add(0); // Marcar punto de inicio como visitado
    }
    
    // Visitar todos los clientes
    while (route.length < customers.length) {
        let nearestIdx = -1;
        let nearestDistance = Infinity;
        
        // Encontrar cliente más cercano no visitado
        for (let i = 1; i < locations.length; i++) {
            if (!visited.has(i)) {
                const distance = matrix.distances[currentIdx][i];
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIdx = i;
                }
            }
        }
        
        if (nearestIdx === -1) break; // No hay más clientes
        
        // Agregar a ruta
        route.push({
            customer: customers[nearestIdx - (startingPoint ? 1 : 0)],
            index: nearestIdx - (startingPoint ? 1 : 0),
            distance: nearestDistance,
            time: matrix.durations[currentIdx][nearestIdx]
        });
        
        totalDistance += nearestDistance;
        totalTime += matrix.durations[currentIdx][nearestIdx];
        
        visited.add(nearestIdx);
        currentIdx = nearestIdx;
    }
    
    return {
        optimized_route: route,
        total_distance_meters: totalDistance,
        total_time_seconds: totalTime,
        customer_count: customers.length
    };
}

module.exports = {
    getDistanceMatrix,
    optimizeRoute
};
```

### 2. API Routes Endpoint

**Archivo**: `api/src/routes/routes.js`

```javascript
const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');
const authenticateToken = require('../middleware/auth');
const osrmService = require('../services/osrmService');

// ============================================================================
// POST /api/routes/optimize
// Calcula ruta óptima para un conjunto de clientes
// ============================================================================
router.post('/optimize', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores' });
    }
    
    try {
        const { customer_ids, starting_point } = req.body;
        
        if (!customer_ids || customer_ids.length === 0) {
            return res.status(400).json({ error: 'Se requieren clientes' });
        }
        
        // Obtener datos de clientes from DB
        const customersResult = await pool.query(`
            SELECT id, name, address, 
                   ST_Y(geom::geometry) as lat, 
                   ST_X(geom::geometry) as lng
            FROM customers
            WHERE id = ANY($1)
        `, [customer_ids]);
        
        const customers = customersResult.rows;
        
        // Calcular ruta óptima
        const optimized = await osrmService.optimizeRoute(
            customers,
            starting_point // {lat, lng} del almacén (opcional)
        );
        
        res.json(optimized);
        
    } catch (error) {
        console.error('[Routes] Error optimizing:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// POST /api/routes/create
// Crea una ruta en la BD
// ============================================================================
router.post('/create', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores' });
    }
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { name, optimized_route, total_distance_meters, total_time_seconds } = req.body;
        
        // 1. Crear ruta
        const routeResult = await client.query(`
            INSERT INTO routes (name, optimized_json_cache, total_distance_meters, total_time_seconds)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [
            name || `Ruta ${new Date().toISOString().slice(0, 10)}`,
            JSON.stringify(optimized_route),
            total_distance_meters,
            total_time_seconds
        ]);
        
        const routeId = routeResult.rows[0].id;
        
        // 2. Agregar clientes en orden
        for (let i = 0; i < optimized_route.length; i++) {
            const item = optimized_route[i];
            await client.query(`
                INSERT INTO route_customers (route_id, customer_id, sort_order)
                VALUES ($1, $2, $3)
            `, [routeId, item.customer.id, i + 1]);
        }
        
        await client.query('COMMIT');
        
        res.json({
            id: routeId,
            message: 'Ruta creada exitosamente'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Routes] Error creating:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// ============================================================================
// POST /api/routes/assign
// Asigna una ruta a un empleado para una fecha
// ============================================================================
router.post('/assign', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores' });
    }
    
    try {
        const { employee_id, route_id, date } = req.body;
        
        const result = await pool.query(`
            INSERT INTO route_assignments (employee_id, route_id, date, status)
            VALUES ($1, $2, $3, 'assigned')
            ON CONFLICT (employee_id, date) DO UPDATE 
            SET route_id = EXCLUDED.route_id, status = 'assigned'
            RETURNING id
        `, [employee_id, route_id, date]);
        
        res.json({
            id: result.rows[0].id,
            message: 'Ruta asignada exitosamente'
        });
        
    } catch (error) {
        console.error('[Routes] Error assigning:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/routes/me/route
// Obtiene la ruta asignada al vendedor para hoy
// ============================================================================
router.get('/me/route', authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.id;
        const today = new Date().toISOString().split('T')[0];
        
        // Obtener asignación
        const assignmentResult = await pool.query(`
            SELECT ra.id as assignment_id, r.id as route_id, r.name, 
                   r.total_distance_meters, r.total_time_seconds,
                   r.optimized_json_cache
            FROM route_assignments ra
            INNER JOIN routes r ON ra.route_id = r.id
            WHERE ra.employee_id = $1 AND ra.date = $2
            LIMIT 1
        `, [employeeId, today]);
        
        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ message: 'Sin ruta asignada hoy' });
        }
        
        const assignment = assignmentResult.rows[0];
        
        // Obtener clientes en orden
        const customersResult = await pool.query(`
            SELECT c.id, c.name, c.address,
                   ST_Y(c.geom::geometry) as lat,
                   ST_X(c.geom::geometry) as lng,
                   rc.sort_order,
                   COALESCE(rs.status, 'pending') as visit_status
            FROM route_customers rc
            INNER JOIN customers c ON rc.customer_id = c.id
            LEFT JOIN route_stops rs ON (rs.route_assignment_id = $1 AND rs.customer_id = c.id)
            WHERE rc.route_id = $2
            ORDER BY rc.sort_order ASC
        `, [assignment.assignment_id, assignment.route_id]);
        
        res.json({
            route: assignment,
            customers: customersResult.rows
        });
        
    } catch (error) {
        console.error('[Routes] Error fetching:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
```

---

## 🎨 Frontend (Admin Panel)

### Crear Componente de Optimización de Rutas

**Archivo**: `admin-panel/src/components/RouteOptimizer.jsx`

```jsx
import React, { useState, useEffect } from 'react';
import api from '../services/api';

export default function RouteOptimizer() {
    const [customers, setCustomers] = useState([]);
    const [selectedCustomers, setSelectedCustomers] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [optimizing, setOptimizing] = useState(false);
    const [optimizedRoute, setOptimizedRoute] = useState(null);
    const [assignDate, setAssignDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [custRes, empRes] = await Promise.all([
                api.get('/api/customers'),
                api.get('/api/employees')
            ]);
            setCustomers(custRes.data);
            setEmployees(empRes.data);
        } catch (error) {
            console.error('Error loading data:', error);
        }
    };

    const handleOptimize = async () => {
        if (selectedCustomers.length === 0) {
            alert('Selecciona al menos 1 cliente');
            return;
        }

        setOptimizing(true);
        try {
            // Enviar clientes seleccionados a API
            const response = await api.post('/api/routes/optimize', {
                customer_ids: selectedCustomers,
                starting_point: null // O punto de almacén si existe
            });

            setOptimizedRoute(response.data);
        } catch (error) {
            alert('Error: ' + error.message);
        } finally {
            setOptimizing(false);
        }
    };

    const handleSaveRoute = async () => {
        if (!optimizedRoute) return;

        try {
            const routeRes = await api.post('/api/routes/create', {
                name: `Ruta ${assignDate}`,
                optimized_route: optimizedRoute.optimized_route,
                total_distance_meters: optimizedRoute.total_distance_meters,
                total_time_seconds: optimizedRoute.total_time_seconds
            });

            if (selectedEmployee) {
                await api.post('/api/routes/assign', {
                    employee_id: selectedEmployee,
                    route_id: routeRes.data.id,
                    date: assignDate
                });
                alert('✅ Ruta creada y asignada!');
            } else {
                alert('✅ Ruta creada. Asigna a un vendedor después.');
            }

            setOptimizedRoute(null);
            setSelectedCustomers([]);
        } catch (error) {
            alert('Error: ' + error.message);
        }
    };

    return (
        <div className="p-6 bg-slate-900 rounded-xl">
            <h2 className="text-xl font-bold text-white mb-4">🚀 Optimizador de Rutas</h2>

            <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Selector de Clientes */}
                <div>
                    <label className="block text-sm font-bold text-slate-300 mb-2">
                        Clientes a Visitar
                    </label>
                    <div className="border border-slate-700 rounded p-3 max-h-64 overflow-y-auto">
                        {customers.map(c => (
                            <label key={c.id} className="flex items-center gap-2 p-2 hover:bg-slate-800 cursor-pointer">
                                <input 
                                    type="checkbox"
                                    checked={selectedCustomers.includes(c.id)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedCustomers([...selectedCustomers, c.id]);
                                        } else {
                                            setSelectedCustomers(selectedCustomers.filter(id => id !== c.id));
                                        }
                                    }}
                                    className="w-4 h-4"
                                />
                                <span className="text-sm text-slate-200">{c.name}</span>
                            </label>
                        ))}
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                        {selectedCustomers.length} clientes seleccionados
                    </div>
                </div>

                {/* Detalles de Ruta Optimizada */}
                {optimizedRoute && (
                    <div>
                        <label className="block text-sm font-bold text-slate-300 mb-2">
                            📊 Ruta Optimizada
                        </label>
                        <div className="bg-slate-800 p-3 rounded text-sm text-slate-200">
                            <p>📍 Clientes: {optimizedRoute.customer_count}</p>
                            <p>🛣️ Distancia: {(optimizedRoute.total_distance_meters / 1000).toFixed(2)} km</p>
                            <p>⏱️ Tiempo: {Math.round(optimizedRoute.total_time_seconds / 60)} min</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Selector de Vendedor */}
            <div className="mb-4">
                <label className="block text-sm font-bold text-slate-300 mb-2">
                    Asignar a Vendedor
                </label>
                <select 
                    value={selectedEmployee || ''}
                    onChange={(e) => setSelectedEmployee(parseInt(e.target.value))}
                    className="w-full bg-slate-800 text-slate-200 border border-slate-700 rounded px-3 py-2"
                >
                    <option value="">Seleccionar...</option>
                    {employees.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                </select>
            </div>

            {/* Fecha */}
            <div className="mb-4">
                <label className="block text-sm font-bold text-slate-300 mb-2">Fecha</label>
                <input 
                    type="date"
                    value={assignDate}
                    onChange={(e) => setAssignDate(e.target.value)}
                    className="w-full bg-slate-800 text-slate-200 border border-slate-700 rounded px-3 py-2"
                />
            </div>

            {/* Botones */}
            <div className="flex gap-2">
                <button 
                    onClick={handleOptimize}
                    disabled={optimizing}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded disabled:opacity-50"
                >
                    {optimizing ? '⏳ Optimizando...' : '🎯 Optimizar Ruta'}
                </button>
                
                {optimizedRoute && (
                    <button 
                        onClick={handleSaveRoute}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded"
                    >
                        ✅ Guardar Ruta
                    </button>
                )}
            </div>

            {/* Lista de Clientes en Orden */}
            {optimizedRoute && (
                <div className="mt-6">
                    <h3 className="text-sm font-bold text-slate-300 mb-3">📋 Orden de Visita:</h3>
                    <div className="space-y-2">
                        {optimizedRoute.optimized_route.map((item, idx) => (
                            <div key={idx} className="bg-slate-800 p-2 rounded text-sm text-slate-200 flex gap-2">
                                <span className="bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                                    {idx + 1}
                                </span>
                                <div>
                                    <p className="font-bold">{item.customer.name}</p>
                                    <p className="text-xs text-slate-400">{item.customer.address}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
```

---

## 📱 Mobile (Flutter)

### Mostrar Ruta Asignada en Flutter

**Archivo**: `mobile/flutter_app/lib/screens/route_screen.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class RouteScreen extends StatefulWidget {
  @override
  State<RouteScreen> createState() => _RouteScreenState();
}

class _RouteScreenState extends State<RouteScreen> {
  List<dynamic> customers = [];
  double totalDistance = 0;
  double totalTime = 0;
  MapController mapController = MapController();
  bool loading = true;

  @override
  void initState() {
    super.initState();
    fetchRoute();
  }

  Future<void> fetchRoute() async {
    try {
      final response = await http.get(
        Uri.parse('http://10.0.2.2:3000/api/routes/me/route'),
        headers: {'Authorization': 'Bearer ${await getToken()}'},
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          customers = data['customers'];
          totalDistance = data['route']['total_distance_meters'] / 1000;
          totalTime = data['route']['total_time_seconds'] / 60;
          loading = false;
        });
      }
    } catch (error) {
      print('Error: $error');
      setState(() => loading = false);
    }
  }

  List<Marker> _buildMarkers() {
    return customers.asMap().entries.map((entry) {
      int idx = entry.key;
      var customer = entry.value;
      
      return Marker(
        point: LatLng(customer['lat'], customer['lng']),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.indigo[600],
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          width: 40,
          height: 40,
          child: Center(
            child: Text(
              '${idx + 1}',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
      );
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Scaffold(
        appBar: AppBar(title: Text('Mi Ruta')),
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (customers.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: Text('Mi Ruta')),
        body: Center(
          child: Text('Sin ruta asignada'),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text('Mi Ruta Hoy'),
        elevation: 0,
      ),
      body: Column(
        children: [
          // Mapa
          Expanded(
            flex: 1,
            child: FlutterMap(
              mapController: mapController,
              options: MapOptions(
                center: LatLng(
                  customers[0]['lat'],
                  customers[0]['lng'],
                ),
                zoom: 15,
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                  subdomains: ['a', 'b', 'c'],
                ),
                MarkerLayer(markers: _buildMarkers()),
                PolylineLayer(
                  polylines: [
                    Polyline(
                      points: customers
                          .map((c) => LatLng(c['lat'], c['lng']))
                          .toList(),
                      color: Colors.indigo[600]!,
                      strokeWidth: 3,
                    ),
                  ],
                ),
              ],
            ),
          ),
          // Info de Ruta
          Container(
            padding: EdgeInsets.all(16),
            color: Colors.slate[900],
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '📊 Resumen de Ruta',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildStatBox('🛣️', '${totalDistance.toStringAsFixed(1)} km'),
                    _buildStatBox('⏱️', '${totalTime.toStringAsFixed(0)} min'),
                    _buildStatBox('📍', '${customers.length} clientes'),
                  ],
                ),
              ],
            ),
          ),
          // Lista de Clientes
          Expanded(
            flex: 1,
            child: ListView.builder(
              itemCount: customers.length,
              itemBuilder: (context, idx) {
                var customer = customers[idx];
                bool visited = customer['visit_status'] == 'visited';
                
                return ListTile(
                  leading: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: visited ? Colors.green[600] : Colors.indigo[600],
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        '${idx + 1}',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  title: Text(
                    customer['name'],
                    style: TextStyle(
                      color: Colors.white,
                      decoration: visited ? TextDecoration.lineThrough : null,
                    ),
                  ),
                  subtitle: Text(
                    customer['address'],
                    style: TextStyle(color: Colors.slate[400]),
                  ),
                  trailing: visited
                      ? Icon(Icons.check_circle, color: Colors.green[600])
                      : null,
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatBox(String emoji, String value) {
    return Column(
      children: [
        Text(emoji, style: TextStyle(fontSize: 20)),
        SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}
```

---

## 📝 Ejemplos Prácticos

### Ejemplo 1: Crear Ruta vía cURL

```bash
# 1. Optimizar
curl -X POST http://localhost:3000/api/routes/optimize \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_ids": [1, 2, 3, 4, 5]
  }'

# Respuesta:
# {
#   "optimized_route": [...],
#   "total_distance_meters": 15000,
#   "total_time_seconds": 900
# }

# 2. Guardar Ruta
curl -X POST http://localhost:3000/api/routes/create \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ruta Centro 2026-03-23",
    "optimized_route": [...],
    "total_distance_meters": 15000,
    "total_time_seconds": 900
  }'

# 3. Asignar a Vendedor
curl -X POST http://localhost:3000/api/routes/assign \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employee_id": 5,
    "route_id": 1,
    "date": "2026-03-23"
  }'
```

### Ejemplo 2: Asignación Bulk (múltiples vendedores)

```javascript
// Crear rutas para múltiples vendedores
async function assignDailyRoutes(date) {
    const vendedores = await api.get('/api/employees?type=sales');
    const clientes = await api.get('/api/customers');
    
    // Dividir clientes entre vendedores
    const clientesPorVendedor = divideClientsEvenly(clientes, vendedores.length);
    
    for (let i = 0; i < vendedores.length; i++) {
        const optimized = await api.post('/api/routes/optimize', {
            customer_ids: clientesPorVendedor[i].map(c => c.id)
        });
        
        const routeRes = await api.post('/api/routes/create', optimized);
        
        await api.post('/api/routes/assign', {
            employee_id: vendedores[i].id,
            route_id: routeRes.data.id,
            date: date
        });
    }
}
```

---

## ✅ Próximos Pasos

- [ ] Implementar algoritmo TSP mejorado (con Simulated Annealing)
- [ ] Tracking en tiempo real de vendedor en ruta
- [ ] Notificaciones cuando llega a cliente
- [ ] Captura de fotos/firmas en puntos de visita
- [ ] Re-optimización dinámica (si hay cancelaciones)
- [ ] Analytics de ruta (tiempo real vs estimado)

---

**¡Listo para implementar!** 🚀
