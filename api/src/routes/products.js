/**
 * Products Route — Módulo de Pedidos v11
 *
 * - GET  /api/products           → catálogo (+ delta updates por ?since=ISO)
 * - GET  /api/products/categorias → lista de todas las categorías/subcategorías únicas
 * - POST /api/products/import    → importación masiva WooCommerce CSV/JSON
 *                                   Solo actualiza datos catálogo, nunca precios
 * - PUT  /api/products/:id       → edición comercial (precios, stock) + audit log
 * - DELETE /api/products/:id     → desactivar producto (soft delete)
 */
'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../db/postgres');

// ── Guard: solo admin puede modificar ────────────────────────────────────────
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo admins pueden modificar el catálogo.' });
    }
    next();
};

// ── Helpers ───────────────────────────────────────────────────────────────────
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
// GET /api/products/categorias
// Devuelve árbol de categorías únicas (todas las combinaciones presentes).
// Usado por el panel y la APK para construir el filtro de categorías.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/categorias', auth, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT DISTINCT UNNEST(categorias) AS categoria
            FROM products
            WHERE active = TRUE AND categorias IS NOT NULL
            ORDER BY categoria ASC
        `);
        const list = result.rows.map(r => r.categoria).filter(Boolean);
        res.json({ categorias: list });
    } catch (err) {
        console.error('[Products] GET /categorias error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products
// Devuelve catálogo activo. Soporta ?since=ISO para delta sync (APK offline).
// ?categoria=X filtra si X está en CUALQUIERA de las categorías del producto.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
    try {
        const { since, page = 1, limit = 100, categoria, tipo, tag } = req.query;
        const params = [];
        let whereClause = 'WHERE p.active = TRUE';

        if (since) {
            params.push(since);
            whereClause += ` AND p.last_updated > $${params.length}`;
        }
        if (categoria) {
            // Busca en el array completo de categorías (no solo la primera)
            params.push(categoria);
            whereClause += ` AND $${params.length} ILIKE ANY(p.categorias)`;
        }
        if (tipo) {
            params.push(tipo);
            whereClause += ` AND p.tipo_producto ILIKE $${params.length}`;
        }
        if (tag) {
            params.push(tag);
            whereClause += ` AND $${params.length} = ANY(p.tags)`;
        }

        // Paginación
        const pageNum  = Math.max(1, parseInt(page));
        const limitNum = Math.min(500, Math.max(10, parseInt(limit)));
        const offset   = (pageNum - 1) * limitNum;
        params.push(limitNum, offset);

        const result = await db.query(`
            SELECT
                p.id, p.external_id, p.titulo, p.descripcion_corta,
                p.precio_con_igv, p.precio_sin_igv, p.stock_general,
                p.categoria, p.categorias, p.tipo_producto, p.tags, p.imagen_url,
                p.last_updated
            FROM products p
            ${whereClause}
            ORDER BY p.titulo ASC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        const countResult = await db.query(`
            SELECT COUNT(*) as total FROM products p ${whereClause}
        `, params.slice(0, params.length - 2));

        res.json({
            total: parseInt(countResult.rows[0].total),
            page: pageNum,
            limit: limitNum,
            products: result.rows
        });
    } catch (err) {
        console.error('[Products] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products/import
// Importación masiva desde JSON (array) o CSV (WooCommerce export).
// Solo campos de catálogo — NUNCA toca precios ni stock.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/import', auth, adminOnly, async (req, res) => {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Se espera un array de productos.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        let inserted = 0;
        let updated  = 0;

        for (const item of items) {
            // ── Mapeo flexible WooCommerce ES/EN → nuestros campos ──────────────────
            const external_id = String(
                item.ID || item.id || item.external_id || ''
            ).trim();

            const titulo = (
                item.Nombre || item.Name || item.titulo || item.name || ''
            ).trim();

            const descripcion = (
                item['Descripción'] || item['Descripcion'] ||
                item.Description || item.descripcion || ''
            ).trim();

            const descripcion_corta = (
                item['Descripción corta'] || item['Descripcion corta'] ||
                item['Short description'] || item.descripcion_corta || ''
            ).trim();

            // ── Categorías múltiples ──────────────────────────────────────────────
            // WooCommerce exporta: "Adelgazantes, Multivitamínicos, Sistema Digestivo"
            // Guardamos TODAS en el array categorias[], y la primera como categoria principal
            const categoriaRaw = (
                item['Categorías'] || item['Categorias'] ||
                item.Categories || item.categoria || ''
            ).trim();

            // Woo puede usar " > " para subcategorías dentro de una categoría
            // Ej: "Suplementos > Adelgazantes" → aplanamos ambos niveles
            const categorias = categoriaRaw
                ? [...new Set(
                    categoriaRaw
                        .split(',')
                        .flatMap(c => c.split('>').map(s => s.trim()))
                        .filter(Boolean)
                  )]
                : [];
            // La categoría "principal" es la primera del CSV (antes del primer ">")
            const categoria = categoriaRaw
                ? categoriaRaw.split(',')[0].split('>')[0].trim()
                : null;

            const tipo_producto = (
                item.Tipo || item.Type || item.tipo_producto || ''
            ).trim() || null;

            // Etiquetas → tags array
            const tagsRaw = (
                item.Etiquetas || item.Tags || item.tags || ''
            ).trim();
            const tags = tagsRaw
                ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
                : (Array.isArray(item.tags) ? item.tags : []);

            // Imágenes → primera URL si hay varias separadas por coma
            const imagenesRaw = (
                item.Imágenes || item['Imágenes'] || item.Images ||
                item['Image URL'] || item.imagen_url || ''
            ).trim();
            const imagen_url = imagenesRaw
                ? imagenesRaw.split(',')[0].trim()
                : null;

            if (!titulo) continue; // Skip filas vacías

            if (external_id) {
                const existing = await client.query(
                    'SELECT id FROM products WHERE external_id = $1', [external_id]
                );
                if (existing.rowCount > 0) {
                    await client.query(`
                        UPDATE products SET
                            titulo = $1, descripcion = $2, descripcion_corta = $3,
                            categoria = $4, categorias = $5, tipo_producto = $6,
                            tags = $7, imagen_url = $8, last_updated = NOW()
                        WHERE external_id = $9
                    `, [titulo, descripcion, descripcion_corta, categoria, categorias,
                        tipo_producto, tags, imagen_url, external_id]);
                    updated++;
                } else {
                    await client.query(`
                        INSERT INTO products
                            (external_id, titulo, descripcion, descripcion_corta,
                             categoria, categorias, tipo_producto, tags, imagen_url)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    `, [external_id, titulo, descripcion, descripcion_corta,
                        categoria, categorias, tipo_producto, tags, imagen_url]);
                    inserted++;
                }
            } else {
                await client.query(`
                    INSERT INTO products
                        (titulo, descripcion, descripcion_corta,
                         categoria, categorias, tipo_producto, tags, imagen_url)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                `, [titulo, descripcion, descripcion_corta,
                    categoria, categorias, tipo_producto, tags, imagen_url]);
                inserted++;
            }
        }

        await client.query('COMMIT');
        await logAudit(req.user.id, req.user.role, 'products', null, 'import', null,
            { inserted, updated, total: items.length });

        res.json({ success: true, inserted, updated, total: items.length });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Products] Import error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/products/:id
// Edición comercial por Admin: precios, stock, nombre, etc. + audit log.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', auth, adminOnly, async (req, res) => {
    const { id } = req.params;
    const {
        titulo, descripcion, descripcion_corta, precio_con_igv,
        precio_sin_igv, stock_general, categoria, categorias,
        tipo_producto, tags, imagen_url, active
    } = req.body;

    try {
        const prev = await db.query('SELECT * FROM products WHERE id = $1', [id]);
        if (prev.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado.' });

        const result = await db.query(`
            UPDATE products SET
                titulo            = COALESCE($1,  titulo),
                descripcion       = COALESCE($2,  descripcion),
                descripcion_corta = COALESCE($3,  descripcion_corta),
                precio_con_igv    = COALESCE($4,  precio_con_igv),
                precio_sin_igv    = COALESCE($5,  precio_sin_igv),
                stock_general     = COALESCE($6,  stock_general),
                categoria         = COALESCE($7,  categoria),
                categorias        = COALESCE($8,  categorias),
                tipo_producto     = COALESCE($9,  tipo_producto),
                tags              = COALESCE($10, tags),
                imagen_url        = COALESCE($11, imagen_url),
                active            = COALESCE($12, active),
                last_updated      = NOW()
            WHERE id = $13
            RETURNING *
        `, [titulo, descripcion, descripcion_corta, precio_con_igv, precio_sin_igv,
            stock_general, categoria, categorias, tipo_producto, tags, imagen_url, active, id]);

        await logAudit(req.user.id, req.user.role, 'product', parseInt(id),
            'update', prev.rows[0], result.rows[0]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[Products] PUT error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/products/:id   (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', auth, adminOnly, async (req, res) => {
    try {
        await db.query(`UPDATE products SET active = FALSE, last_updated = NOW() WHERE id = $1`, [req.params.id]);
        await logAudit(req.user.id, req.user.role, 'product', parseInt(req.params.id), 'delete', null, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
