# GPS Tracking System - Step-by-Step Implementation

## Fase 1: Base de Datos
- [x] Crear `database/migration_v11_orders.sql` con: system_settings, products, orders, order_items, audit_logs
- [x] Actualizar rol `employees` para soportar 'almacen'
- [x] Añadir columna `active` a customers

## Fase 2: Backend API (Node.js)
- [x] Crear `api/src/routes/products.js` (GET delta, POST/import, PUT con audit)
- [x] Crear `api/src/routes/orders.js` (POST dedup, GET filtros, PATCH status + stock)
- [x] Crear `api/src/routes/settings.js` (GET, PATCH con audit)
- [x] Modificar `api/src/routes/customers.js` (añadir GET /nearby con PostGIS)
- [x] Registrar rutas en `api/src/server.js`

## Fase 3: Admin Panel (React)
- [x] Crear `admin-panel/src/pages/Catalog.jsx`
- [x] Crear `admin-panel/src/pages/Orders.jsx`
- [x] Crear `admin-panel/src/pages/Settings.jsx`
- [x] Conectar nuevas páginas al sidebar/routing del Dashboard

## Pendiente
- [ ] Aplicar migración v11 en el servidor de producción
