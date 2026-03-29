/**
 * products.js — Rutas del Catálogo de Productos
 *
 * Endpoints:
 *  GET  /api/products            — Catálogo (con delta-sync ?since=timestamp)
 *  GET  /api/products/:id        — Detalle de un producto
 *  POST /api/products/import     — Importación masiva JSON/WooCommerce
 *  PUT  /api/products/:id        — Edición (con audit log automático)
 *  DELETE /api/products/:id      — Desactivar producto (soft delete)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db/postgres');
const auth    = require('../middleware/auth');

// Guard: solo admin puede modificar el catálogo
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
};

// ---------------------------------------------------------------------------
// GET /api/products
// Lista el catálogo. Soporta delta-sync: ?since=ISO_TIMESTAMP
// La APK debe guardar el timestamp de la última sync y enviarlo en `since`.
// ---------------------------------------------------------------------------
router.get('/', auth, async (req, res) => {
    try {
        const { since, categoria, tipo, tag, limit = 1000 } = req.query;

        const params = [];
        let whereClause = 'WHERE p.is_active = TRUE';

        if (since) {
            params.push(since);
            whereClause += ` AND p.last_updated > $${params.length}`;
        }
        if (categoria) {
            params.push(categoria);
            whereClause += ` AND p.categoria = $${params.length}`;
        }
        if (tipo) {
            params.push(tipo);
            whereClause += ` AND p.tipo_producto = $${params.length}`;
        }
        if (tag) {
            params.push(tag);
            whereClause += ` AND $${params.length} = ANY(p.tags)`;
        }

        params.push(parseInt(limit));

        const result = await db.query(`
            SELECT 
                p.id, p.external_id, p.titulo, p.descripcion_corta,
                p.precio_con_igv, p.precio_sin_igv, p.stock_general,
                p.categoria, p.tipo_producto, p.tags, p.imagen_url,
                p.last_updated
            FROM products p
            ${whereClause}
            ORDER BY p.titulo ASC
            LIMIT $${params.length}
        `, params);

        res.json({
            count: result.rows.length,
            synced_at: new Date().toISOString(),
            products: result.rows
        });
    } catch (err) {
        console.error('[PRODUCTS] GET error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/products/:id
// ---------------------------------------------------------------------------
router.get('/:id', auth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM products WHERE id = $1 AND is_active = TRUE',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/products/import
// Importación masiva desde JSON de WooCommerce o formato propio.
// Hace UPSERT por external_id para actualizaciones de stock/precio.
// ---------------------------------------------------------------------------
router.post('/import', auth, adminOnly, async (req, res) => {
    const products = Array.isArray(req.body) ? req.body : req.body.products;

    if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'Body debe ser un array de productos o { products: [...] }' });
    }

    const client = await db.connect();
    const results = { inserted: 0, updated: 0, errors: [] };

    try {
        await client.query('BEGIN');

        for (const p of products) {
            // Mapeo flexible: soporta campos WooCommerce snake_case y camelCase
            const external_id       = String(p.id || p.external_id || '').trim();
            const titulo            = String(p.name || p.titulo || '').trim();
            const descripcion       = p.description || p.descripcion || null;
            const descripcion_corta = p.short_description || p.descripcion_corta || null;
            const imagen_url        = p.images?.[0]?.src || p.imagen_url || null;
            const precio_con_igv    = parseFloat(p.regular_price || p.precio_con_igv || 0) || 0;
            const precio_sin_igv    = parseFloat(p.precio_sin_igv || (precio_con_igv / 1.18).toFixed(2)) || 0;
            const stock_general     = parseInt(p.stock_quantity ?? p.stock_general ?? 0) || 0;
            const categoria         = p.categories?.[0]?.name || p.categoria || null;
            const tipo_producto     = p.type || p.tipo_producto || null;
            const tags_raw          = p.tags || [];
            const tags              = Array.isArray(tags_raw)
                ? tags_raw.map(t => (typeof t === 'object' ? t.name : String(t)).trim())
                : [];

            if (!titulo) {
                results.errors.push({ external_id, reason: 'titulo requerido' });
                continue;
            }

            try {
                const upsertRes = await client.query(`
                    INSERT INTO products
                        (external_id, titulo, descripcion, descripcion_corta,
                         precio_con_igv, precio_sin_igv, stock_general,
                         categoria, tipo_producto, tags, imagen_url)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                    ON CONFLICT (external_id) DO UPDATE SET
                        titulo           = EXCLUDED.titulo,
                        descripcion      = EXCLUDED.descripcion,
                        descripcion_corta= EXCLUDED.descripcion_corta,
                        precio_con_igv   = EXCLUDED.precio_con_igv,
                        precio_sin_igv   = EXCLUDED.precio_sin_igv,
                        stock_general    = EXCLUDED.stock_general,
                        categoria        = EXCLUDED.categoria,
                        tipo_producto    = EXCLUDED.tipo_producto,
                        tags             = EXCLUDED.tags,
                        imagen_url       = EXCLUDED.imagen_url,
                        last_updated     = CURRENT_TIMESTAMP
                    RETURNING (xmax = 0) AS is_new
                `, [external_id || null, titulo, descripcion, descripcion_corta,
                    precio_con_igv, precio_sin_igv, stock_general,
                    categoria, tipo_producto, tags, imagen_url]);

                if (upsertRes.rows[0]?.is_new) {
                    results.inserted++;
                } else {
                    results.updated++;
                }
            } catch (rowErr) {
                results.errors.push({ external_id, reason: rowErr.message });
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, ...results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PRODUCTS] Import error:', err.message);
        res.status(500).json({ error: 'Import failed', detail: err.message });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// PUT /api/products/:id
// Edición de cualquier campo editable (no external_id). Genera audit_log.
// ---------------------------------------------------------------------------
router.put('/:id', auth, adminOnly, async (req, res) => {
    const { id } = req.params;
    const {
        titulo, descripcion, descripcion_corta,
        precio_con_igv, precio_sin_igv, stock_general,
        categoria, tipo_producto, tags, imagen_url, is_active
    } = req.body;

    try {
        // Snapshot anterior para el audit log
        const old = await db.query('SELECT * FROM products WHERE id = $1', [id]);
        if (old.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
        const oldData = old.rows[0];

        const fields = [];
        const params = [];
        let i = 1;

        const addField = (col, val) => {
            if (val !== undefined) { fields.push(`${col} = $${i++}`); params.push(val); }
        };

        addField('titulo',            titulo);
        addField('descripcion',       descripcion);
        addField('descripcion_corta', descripcion_corta);
        addField('precio_con_igv',    precio_con_igv !== undefined ? parseFloat(precio_con_igv) : undefined);
        addField('precio_sin_igv',    precio_sin_igv !== undefined ? parseFloat(precio_sin_igv) : undefined);
        addField('stock_general',     stock_general !== undefined  ? parseInt(stock_general) : undefined);
        addField('categoria',         categoria);
        addField('tipo_producto',     tipo_producto);
        addField('imagen_url',        imagen_url);
        addField('is_active',         is_active);

        if (Array.isArray(tags)) {
            fields.push(`tags = $${i++}`);
            params.push(tags);
        }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(id);
        const result = await db.query(
            `UPDATE products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
            params
        );

        // Audit log
        await db.query(`
            INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, performed_by)
            VALUES ('product', $1, 'update', $2, $3, $4)
        `, [id, JSON.stringify(oldData), JSON.stringify(result.rows[0]), req.user.id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[PRODUCTS] PUT error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/products/:id — Soft delete (is_active = FALSE)
// ---------------------------------------------------------------------------
router.delete('/:id', auth, adminOnly, async (req, res) => {
    try {
        const result = await db.query(
            'UPDATE products SET is_active = FALSE WHERE id = $1 RETURNING id, titulo',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
        res.json({ success: true, ...result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
