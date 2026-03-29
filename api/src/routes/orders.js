/**
 * Orders Route — Módulo de Pedidos v11
 *
 * - POST  /api/orders              → crear pedido desde APK (offline-safe, deduplicación por client_id)
 * - GET   /api/orders              → listado Admin/Almacén con filtros
 * - PATCH /api/orders/:id/status   → cambiar estado + descuento stock si 'entregado'
 */
'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../db/postgres');

async function logAudit(actorId, actorRole, entity, entityId, action, oldValue, newValue) {
    try {
        await db.query(
            `INSERT INTO audit_logs (entity, entity_id, action, old_value, new_value, actor_id, actor_role)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [entity, entityId, action, JSON.stringify(oldValue), JSON.stringify(newValue), actorId, actorRole]
        );
    } catch (_) { /* no crítico */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders
// Recibe un pedido completo desde la APK.
// Deduplicación por client_id (UUID generado en el móvil).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
    const {
        client_id, customer_id, trip_id, items,
        notas = null, descuento = 0
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El pedido debe tener al menos un ítem.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Deduplicación: si el client_id ya existe, devolvemos el pedido guardado
        if (client_id) {
            const exists = await client.query('SELECT id FROM orders WHERE client_id = $1', [client_id]);
            if (exists.rowCount > 0) {
                await client.query('ROLLBACK');
                return res.status(200).json({ success: true, orderId: exists.rows[0].id, duplicate: true });
            }
        }

        // Calcular totales
        let total_sin_igv = 0;
        for (const item of items) {
            total_sin_igv += (item.price_unit || 0) * (item.quantity || 1);
        }
        total_sin_igv = parseFloat((total_sin_igv - (descuento || 0)).toFixed(2));

        // Leer % IGV de las settings globales
        const igvSetting = await client.query(
            `SELECT value FROM system_settings WHERE key = 'IGV_ENABLED'`
        );
        const igvPctRow = await client.query(
            `SELECT value FROM system_settings WHERE key = 'IGV_PERCENT'`
        );
        const igvEnabled = igvSetting.rows[0]?.value === 'true';
        const igvPct     = igvEnabled ? parseFloat(igvPctRow.rows[0]?.value || '18') / 100 : 0;
        const total_con_igv = parseFloat((total_sin_igv * (1 + igvPct)).toFixed(2));

        // Insertar cabecera
        const orderResult = await client.query(`
            INSERT INTO orders
                (client_id, employee_id, customer_id, trip_id, status,
                 total_sin_igv, total_con_igv, descuento, notas, synced)
            VALUES ($1,$2,$3,$4,'pendiente',$5,$6,$7,$8,TRUE)
            RETURNING id
        `, [client_id, req.user.id, customer_id || null, trip_id || null,
            total_sin_igv, total_con_igv, descuento, notas]);

        const orderId = orderResult.rows[0].id;

        // Insertar ítems
        for (const item of items) {
            const titulo = item.titulo || 'Producto';
            const qty    = parseInt(item.quantity) || 1;
            const price  = parseFloat(item.price_unit) || 0;
            await client.query(`
                INSERT INTO order_items (order_id, product_id, titulo, quantity, price_unit)
                VALUES ($1,$2,$3,$4,$5)
            `, [orderId, item.product_id || null, titulo, qty, price]);
        }

        await client.query('COMMIT');

        res.status(201).json({ success: true, orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Orders] POST error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders
// Admin: todos los pedidos. Almacén: todos. Vendedor: solo los suyos.
// Filtros: ?status=pendiente&employee_id=1&customer_id=2&date=2026-03-29
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
    try {
        const { status, employee_id, customer_id, date, page = 1, limit = 50 } = req.query;
        const params  = [];
        const filters = [];

        // Vendedor solo ve sus propios pedidos
        if (req.user.role === 'employee') {
            params.push(req.user.id);
            filters.push(`o.employee_id = $${params.length}`);
        } else if (employee_id) {
            params.push(parseInt(employee_id));
            filters.push(`o.employee_id = $${params.length}`);
        }

        if (status) {
            params.push(status);
            filters.push(`o.status = $${params.length}`);
        }
        if (customer_id) {
            params.push(parseInt(customer_id));
            filters.push(`o.customer_id = $${params.length}`);
        }
        if (date) {
            params.push(date);
            filters.push(`DATE(o.created_at AT TIME ZONE 'UTC') = $${params.length}`);
        }

        const where    = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
        const pageNum  = Math.max(1, parseInt(page));
        const limitNum = Math.min(200, Math.max(10, parseInt(limit)));
        const offset   = (pageNum - 1) * limitNum;

        const result = await db.query(`
            SELECT
                o.id, o.client_id, o.status, o.total_sin_igv, o.total_con_igv,
                o.descuento, o.notas, o.created_at, o.updated_at,
                e.name   AS vendedor,
                c.name   AS cliente,
                COUNT(oi.id)::int AS item_count
            FROM orders o
            LEFT JOIN employees e ON e.id = o.employee_id
            LEFT JOIN customers c ON c.id = o.customer_id
            LEFT JOIN order_items oi ON oi.order_id = o.id
            ${where}
            GROUP BY o.id, e.name, c.name
            ORDER BY o.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, limitNum, offset]);

        const countResult = await db.query(
            `SELECT COUNT(DISTINCT o.id) as total FROM orders o ${where}`,
            params
        );

        res.json({
            total: parseInt(countResult.rows[0].total),
            page: pageNum,
            limit: limitNum,
            orders: result.rows
        });
    } catch (err) {
        console.error('[Orders] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id
// Detalle completo de un pedido con sus ítems.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
    try {
        const orderResult = await db.query(`
            SELECT o.*, e.name AS vendedor, c.name AS cliente
            FROM orders o
            LEFT JOIN employees e ON e.id = o.employee_id
            LEFT JOIN customers c ON c.id = o.customer_id
            WHERE o.id = $1
        `, [req.params.id]);

        if (orderResult.rowCount === 0) return res.status(404).json({ error: 'Pedido no encontrado.' });

        // Vendedor solo puede ver sus propios pedidos
        const order = orderResult.rows[0];
        if (req.user.role === 'employee' && order.employee_id !== req.user.id) {
            return res.status(403).json({ error: 'No autorizado.' });
        }

        const itemsResult = await db.query(`
            SELECT oi.*, p.imagen_url, p.categoria
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
            ORDER BY oi.id
        `, [req.params.id]);

        res.json({ ...order, items: itemsResult.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/orders/:id/status
// Cambia estado del pedido. Solo Admin y Almacén pueden avanzarlo.
// Si status = 'entregado', descuenta stock en products.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/status', auth, async (req, res) => {
    const { status } = req.body;
    const STATES = ['pendiente', 'en_proceso', 'listo', 'entregado', 'cancelado'];
    if (!STATES.includes(status)) {
        return res.status(400).json({ error: `Estado inválido. Válidos: ${STATES.join(', ')}` });
    }
    // Solo admin y almacen pueden cambiar estados (vendedor no)
    if (req.user.role === 'employee') {
        return res.status(403).json({ error: 'Solo admin o almacén pueden actualizar estado.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const prev = await client.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
        if (prev.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pedido no encontrado.' });
        }

        const prevStatus = prev.rows[0].status;

        // Actualizar estado
        const updated = await client.query(`
            UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *
        `, [status, req.params.id]);

        // Si pasa a 'entregado', descontar stock real
        if (status === 'entregado' && prevStatus !== 'entregado') {
            const items = await client.query(
                'SELECT product_id, quantity FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL',
                [req.params.id]
            );
            for (const item of items.rows) {
                await client.query(
                    `UPDATE products SET
                        stock_general = GREATEST(stock_general - $1, 0),
                        last_updated  = NOW()
                     WHERE id = $2`,
                    [item.quantity, item.product_id]
                );
            }
        }

        await client.query('COMMIT');

        await logAudit(req.user.id, req.user.role, 'order', parseInt(req.params.id),
            `status_change:${prevStatus}→${status}`, { status: prevStatus }, { status });

        res.json(updated.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Orders] PATCH status error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
