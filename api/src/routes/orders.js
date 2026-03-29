/**
 * orders.js — Rutas de Pedidos (Venta en Ruta)
 *
 * Endpoints:
 *  POST  /api/orders              — Crear pedido (desde APK, con deduplicación)
 *  GET   /api/orders              — Listado con filtros (Admin y Almacén)
 *  GET   /api/orders/:id          — Detalle de pedido con items
 *  PATCH /api/orders/:id/status   — Actualizar estado del pedido
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db/postgres');
const auth    = require('../middleware/auth');

// Guard: admin y almacen pueden gestionar pedidos
const storeOrAdmin = (req, res, next) => {
    if (!['admin','almacen'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin or Almacén role required' });
    }
    next();
};

// ---------------------------------------------------------------------------
// POST /api/orders
// Recibe un pedido de la APK (funciona offline-first: deduplicación por client_id).
// Body: { client_id, customer_id, trip_id, items: [{product_id, quantity, precio_unit}], notas }
// ---------------------------------------------------------------------------
router.post('/', auth, async (req, res) => {
    const { client_id, customer_id, trip_id, items = [], notas } = req.body;
    const employee_id = req.user.id;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El pedido debe contener al menos un item' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Deduplicación: si ya existe este client_id, devolver el pedido existente
        if (client_id) {
            const existing = await client.query(
                'SELECT id FROM orders WHERE client_id = $1',
                [client_id]
            );
            if (existing.rows.length > 0) {
                await client.query('ROLLBACK');
                const full = await db.query(`
                    SELECT o.*, json_agg(row_to_json(oi)) as items
                    FROM orders o
                    LEFT JOIN order_items oi ON oi.order_id = o.id
                    WHERE o.id = $1 GROUP BY o.id
                `, [existing.rows[0].id]);
                return res.status(200).json({ deduplicated: true, order: full.rows[0] });
            }
        }

        // Calcular totales
        let subtotal = 0;
        for (const item of items) {
            subtotal += parseFloat(item.precio_unit || 0) * parseInt(item.quantity || 1);
        }

        // Obtener % IGV desde settings
        const igvSetting = await client.query(
            "SELECT value FROM system_settings WHERE key = 'PEDIDOS_PORCENTAJE_IGV'"
        );
        const igvPct    = parseFloat(igvSetting.rows[0]?.value || '18') / 100;
        const igvCalcSetting = await client.query(
            "SELECT value FROM system_settings WHERE key = 'PEDIDOS_CALCULAR_IGV'"
        );
        const calcIgv   = igvCalcSetting.rows[0]?.value === 'true';
        const igv_monto = calcIgv ? parseFloat((subtotal * igvPct).toFixed(2)) : 0;
        const total     = parseFloat((subtotal + igv_monto).toFixed(2));

        // Insertar pedido
        const orderRes = await client.query(`
            INSERT INTO orders (client_id, employee_id, customer_id, trip_id, subtotal, igv_monto, total, notas)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [client_id || null, employee_id, customer_id || null, trip_id || null,
            subtotal, igv_monto, total, notas || null]);

        const orderId = orderRes.rows[0].id;

        // Insertar items
        for (const item of items) {
            await client.query(`
                INSERT INTO order_items (order_id, product_id, quantity, precio_unit)
                VALUES ($1, $2, $3, $4)
            `, [orderId, item.product_id, parseInt(item.quantity), parseFloat(item.precio_unit)]);
        }

        await client.query('COMMIT');

        // Respuesta con items incluidos
        const result = await db.query(`
            SELECT o.*,
                   json_agg(
                       json_build_object(
                           'id', oi.id, 'product_id', oi.product_id,
                           'quantity', oi.quantity, 'precio_unit', oi.precio_unit,
                           'subtotal', oi.subtotal, 'titulo', p.titulo
                       )
                   ) as items
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN products p     ON p.id = oi.product_id
            WHERE o.id = $1
            GROUP BY o.id
        `, [orderId]);

        console.log(`[ORDERS] New order #${orderId} by emp ${employee_id} (${items.length} items, total ${total})`);
        res.status(201).json(result.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ORDERS] POST error:', err.message);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// GET /api/orders
// Listado de pedidos con filtros para Admin y Almacén.
// Query params: status, employee_id, customer_id, date, limit, offset
// ---------------------------------------------------------------------------
router.get('/', auth, storeOrAdmin, async (req, res) => {
    const { status, employee_id, customer_id, date, limit = 50, offset = 0 } = req.query;

    const params = [];
    let where = 'WHERE 1=1';

    if (status) {
        params.push(status);
        where += ` AND o.status = $${params.length}`;
    }
    if (employee_id) {
        params.push(parseInt(employee_id));
        where += ` AND o.employee_id = $${params.length}`;
    }
    if (customer_id) {
        params.push(parseInt(customer_id));
        where += ` AND o.customer_id = $${params.length}`;
    }
    if (date) {
        params.push(date);
        where += ` AND DATE(o.created_at) = $${params.length}`;
    }

    params.push(parseInt(limit), parseInt(offset));

    try {
        const result = await db.query(`
            SELECT 
                o.id, o.status, o.subtotal, o.igv_monto, o.total, o.notas,
                o.created_at, o.updated_at,
                e.name  as employee_name,
                c.name  as customer_name,
                COUNT(oi.id) as item_count
            FROM orders o
            LEFT JOIN employees e  ON e.id  = o.employee_id
            LEFT JOIN customers c  ON c.id  = o.customer_id
            LEFT JOIN order_items oi ON oi.order_id = o.id
            ${where}
            GROUP BY o.id, e.name, c.name
            ORDER BY o.created_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        // Count total
        const countParams = params.slice(0, params.length - 2);
        const countResult = await db.query(
            `SELECT COUNT(*) as total FROM orders o ${where}`, countParams
        );

        res.json({
            total: parseInt(countResult.rows[0].total),
            count: result.rows.length,
            orders: result.rows
        });
    } catch (err) {
        console.error('[ORDERS] GET error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id — Detalle de pedido con items
// ---------------------------------------------------------------------------
router.get('/:id', auth, storeOrAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                o.*,
                e.name as employee_name,
                c.name as customer_name,
                json_agg(
                    json_build_object(
                        'id', oi.id, 'product_id', oi.product_id,
                        'titulo', p.titulo, 'imagen_url', p.imagen_url,
                        'quantity', oi.quantity, 'precio_unit', oi.precio_unit,
                        'subtotal', oi.subtotal
                    ) ORDER BY oi.id
                ) as items
            FROM orders o
            LEFT JOIN employees e    ON e.id  = o.employee_id
            LEFT JOIN customers c    ON c.id  = o.customer_id
            LEFT JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN products p     ON p.id  = oi.product_id
            WHERE o.id = $1
            GROUP BY o.id, e.name, c.name
        `, [req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status — Cambiar estado del pedido
// Estados: pendiente -> en_proceso -> listo -> entregado (o cancelado)
// Al pasar a 'entregado': descuenta stock real de los productos.
// ---------------------------------------------------------------------------
router.patch('/:id/status', auth, storeOrAdmin, async (req, res) => {
    const { status } = req.body;
    const validStatuses = ['pendiente','en_proceso','listo','entregado','cancelado'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const pgClient = await db.connect();
    try {
        await pgClient.query('BEGIN');

        const orderRes = await pgClient.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
        if (orderRes.rows.length === 0) {
            await pgClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
        }

        const oldStatus = orderRes.rows[0].status;
        if (oldStatus === status) {
            await pgClient.query('ROLLBACK');
            return res.json({ message: 'No change', status });
        }

        // Actualizar estado
        await pgClient.query(
            'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
            [status, req.params.id]
        );

        // Descuento real de stock al entregar
        if (status === 'entregado' && oldStatus !== 'entregado') {
            const items = await pgClient.query(
                'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
                [req.params.id]
            );
            for (const item of items.rows) {
                await pgClient.query(
                    'UPDATE products SET stock_general = GREATEST(0, stock_general - $1) WHERE id = $2',
                    [item.quantity, item.product_id]
                );
            }
            console.log(`[ORDERS] Order #${req.params.id} delivered — stock decremented`);
        }

        // Audit log de cambio de estado
        await pgClient.query(`
            INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, performed_by)
            VALUES ('order', $1, 'status_change', $2, $3, $4)
        `, [req.params.id,
            JSON.stringify({ status: oldStatus }),
            JSON.stringify({ status }),
            req.user.id]);

        await pgClient.query('COMMIT');
        res.json({ success: true, order_id: parseInt(req.params.id), old_status: oldStatus, new_status: status });

    } catch (err) {
        await pgClient.query('ROLLBACK');
        console.error('[ORDERS] PATCH status error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        pgClient.release();
    }
});

module.exports = router;
