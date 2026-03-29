/**
 * products.js — Rutas del Catálogo de Productos
 *
 * Endpoints:
 *  GET    /api/products            — Catálogo (delta-sync ?since=timestamp)
 *  GET    /api/products/:id        — Detalle de un producto
 *  POST   /api/products/import     — Importación masiva: JSON (array) ó CSV WooCommerce
 *  PUT    /api/products/:id        — Edición (con audit log automático)
 *  DELETE /api/products/:id        — Desactivar producto (soft delete)
 *
 * Importación CSV: acepta el export nativo de WooCommerce (columnas en español).
 * Importación JSON: acepta array de objetos (WooCommerce REST API o formato propio).
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db/postgres');
const auth     = require('../middleware/auth');
const { parse: parseCsv } = require('csv-parse/sync');

// Guard: solo admin puede modificar el catálogo
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Elimina tags HTML y entidades comunes */
const stripHtml = (str) => {
    if (!str) return null;
    return String(str)
        .replace(/<\/?[^>]+(>|$)/g, '')
        .replace(/\\n/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s{2,}/g, ' ')
        .trim() || null;
};

/**
 * Mapea una fila (objeto clave-valor) al formato interno de producto.
 * Soporta:
 *   - CSV de WooCommerce (columnas en español)
 *   - JSON de WooCommerce REST API (campos en inglés)
 *   - Formato propio (campos internos)
 */
const mapToProduct = (row) => {
    // ── Identificadores ──────────────────────────────────────────────────────
    const external_id = String(
        row['ID'] || row.id || row.external_id || ''
    ).trim() || null;

    // ── Textos ────────────────────────────────────────────────────────────────
    const titulo = (
        row['Nombre'] || row.name || row.titulo || ''
    ).trim();

    const descripcion_corta = stripHtml(
        row['Descripción corta'] || row.short_description || row.descripcion_corta || ''
    );

    const descripcion = stripHtml(
        row['Descripción'] || row.description || row.descripcion || ''
    );

    // ── Precios ───────────────────────────────────────────────────────────────
    // WooCommerce CSV: "Precio normal" incluye impuestos / "Precio rebajado" es el de oferta
    const precio_con_igv = parseFloat(
        row['Precio normal'] || row['Precio rebajado'] ||
        row.regular_price   || row.precio_con_igv || 0
    ) || 0;

    const precio_sin_igv = parseFloat(
        row.precio_sin_igv || (precio_con_igv / 1.18).toFixed(2)
    ) || 0;

    // ── Stock ─────────────────────────────────────────────────────────────────
    // "Inventario" en CSV = cantidad; "¿Existencias?" = 1/0 = si lleva control de stock
    const stock_general = parseInt(
        row['Inventario'] ?? row.stock_quantity ?? row.stock_general ?? 0
    ) || 0;

    const is_active = !(
        row['Publicado'] === '0' ||
        row['Publicado'] === 0   ||
        row.is_active === false   ||
        row.status === 'draft'
    );

    // ── Categoría ─────────────────────────────────────────────────────────────
    // WooCommerce CSV: "Categorías" puede ser "Cat1, Cat2 > Subcategoria"
    const cats_raw = row['Categorías'] || row.categoria || '';
    const categoria = String(cats_raw).split(',')[0].split('>').pop().trim() || null;

    // ── Tipo ──────────────────────────────────────────────────────────────────
    const tipo_producto = (
        row['Tipo'] || row.type || row.tipo_producto || 'simple'
    ).trim() || null;

    // ── Tags ──────────────────────────────────────────────────────────────────
    const tags_raw = row['Etiquetas'] || row.tags || '';
    let tags = [];
    if (Array.isArray(tags_raw)) {
        tags = tags_raw.map(t => (typeof t === 'object' ? t.name : String(t)).trim()).filter(Boolean);
    } else if (typeof tags_raw === 'string' && tags_raw.trim()) {
        tags = tags_raw.split(',').map(t => t.trim()).filter(Boolean);
    }

    // ── Imagen ────────────────────────────────────────────────────────────────
    // WooCommerce CSV: "Imágenes" = URL1, URL2, ...  — solo usamos la primera
    const images_raw = row['Imágenes'] || row.imagen_url || '';
    let imagen_url = null;
    if (Array.isArray(images_raw)) {
        imagen_url = images_raw[0]?.src || images_raw[0] || null;
    } else if (typeof images_raw === 'string') {
        imagen_url = images_raw.split(',')[0].trim() || null;
    }

    return {
        external_id, titulo, descripcion, descripcion_corta,
        precio_con_igv, precio_sin_igv, stock_general,
        categoria, tipo_producto, tags, imagen_url, is_active
    };
};

/** Parsea el body: detecta CSV (text/csv) vs JSON automáticamente */
const parseBody = (req) => {
    const ct = (req.headers['content-type'] || '').toLowerCase();

    // --- CSV ---
    if (ct.includes('text/csv') || ct.includes('text/plain')) {
        const raw = req.body; // express.text() debe estar activo
        const records = parseCsv(raw, {
            columns: true,          // primera fila = cabeceras
            skip_empty_lines: true,
            relax_quotes: true,
            trim: true,
            bom: true,              // maneja el BOM de UTF-8 de WooCommerce
        });
        return records;
    }

    // --- JSON ---
    const body = req.body;
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.products)) return body.products;
    return null;
};

// ---------------------------------------------------------------------------
// Middleware global para soportar CSV en este router
// ---------------------------------------------------------------------------
router.use(express.text({ type: ['text/csv', 'text/plain'], limit: '20mb' }));

// ---------------------------------------------------------------------------
// GET /api/products
// ---------------------------------------------------------------------------
router.get('/', auth, async (req, res) => {
    try {
        const { since, categoria, tipo, tag, limit = 1000 } = req.query;

        const params = [];
        let where = 'WHERE p.is_active = TRUE';

        if (since) { params.push(since); where += ` AND p.last_updated > $${params.length}`; }
        if (categoria) { params.push(categoria); where += ` AND p.categoria = $${params.length}`; }
        if (tipo) { params.push(tipo); where += ` AND p.tipo_producto = $${params.length}`; }
        if (tag)  { params.push(tag);  where += ` AND $${params.length} = ANY(p.tags)`; }

        params.push(parseInt(limit));

        const result = await db.query(`
            SELECT p.id, p.external_id, p.titulo, p.descripcion_corta,
                   p.precio_con_igv, p.precio_sin_igv, p.stock_general,
                   p.categoria, p.tipo_producto, p.tags, p.imagen_url, p.last_updated
            FROM products p
            ${where}
            ORDER BY p.titulo ASC
            LIMIT $${params.length}
        `, params);

        res.json({ count: result.rows.length, synced_at: new Date().toISOString(), products: result.rows });
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
// Importación masiva. Acepta:
//   Content-Type: text/csv       → CSV exportado de WooCommerce (columnas en español)
//   Content-Type: application/json → Array JSON (WooCommerce REST o formato propio)
// UPSERT por external_id.
// ---------------------------------------------------------------------------
router.post('/import', auth, adminOnly, async (req, res) => {
    let rows;
    try {
        rows = parseBody(req);
    } catch (parseErr) {
        return res.status(400).json({ error: 'Error al parsear el archivo', detail: parseErr.message });
    }

    if (!rows || rows.length === 0) {
        return res.status(400).json({
            error: 'Body vacío o formato incorrecto.',
            hint: 'Envía Content-Type: text/csv con el CSV de WooCommerce, o application/json con un array.'
        });
    }

    const client = await db.connect();
    const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    try {
        await client.query('BEGIN');

        for (const row of rows) {
            const p = mapToProduct(row);

            if (!p.titulo) {
                results.skipped++;
                results.errors.push({ external_id: p.external_id, reason: 'Sin título (fila vacía o no es producto simple)' });
                continue;
            }

            // Saltar líneas de variantes (tipo "variation") sin external_id útil
            if ((p.tipo_producto === 'variation' || String(row['Tipo'] || '').toLowerCase() === 'variation')) {
                results.skipped++;
                continue;
            }

            try {
                const upsertRes = await client.query(`
                    INSERT INTO products
                        (external_id, titulo, descripcion, descripcion_corta,
                         precio_con_igv, precio_sin_igv, stock_general,
                         categoria, tipo_producto, tags, imagen_url, is_active)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                    ON CONFLICT (external_id) DO UPDATE SET
                        titulo            = EXCLUDED.titulo,
                        descripcion       = EXCLUDED.descripcion,
                        descripcion_corta = EXCLUDED.descripcion_corta,
                        precio_con_igv    = EXCLUDED.precio_con_igv,
                        precio_sin_igv    = EXCLUDED.precio_sin_igv,
                        stock_general     = EXCLUDED.stock_general,
                        categoria         = EXCLUDED.categoria,
                        tipo_producto     = EXCLUDED.tipo_producto,
                        tags              = EXCLUDED.tags,
                        imagen_url        = EXCLUDED.imagen_url,
                        is_active         = EXCLUDED.is_active,
                        last_updated      = CURRENT_TIMESTAMP
                    RETURNING (xmax = 0) AS is_new
                `, [
                    p.external_id, p.titulo, p.descripcion, p.descripcion_corta,
                    p.precio_con_igv, p.precio_sin_igv, p.stock_general,
                    p.categoria, p.tipo_producto, p.tags, p.imagen_url, p.is_active
                ]);

                if (upsertRes.rows[0]?.is_new) results.inserted++;
                else results.updated++;
            } catch (rowErr) {
                results.errors.push({ external_id: p.external_id, titulo: p.titulo, reason: rowErr.message });
            }
        }

        await client.query('COMMIT');
        console.log(`[PRODUCTS] Import: ${results.inserted} inserted, ${results.updated} updated, ${results.skipped} skipped, ${results.errors.length} errors`);
        res.json({ success: true, total_rows: rows.length, ...results });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Import failed', detail: err.message });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// PUT /api/products/:id  — Edición con audit log
// ---------------------------------------------------------------------------
router.put('/:id', auth, adminOnly, async (req, res) => {
    const { id } = req.params;
    const { titulo, descripcion, descripcion_corta, precio_con_igv, precio_sin_igv,
            stock_general, categoria, tipo_producto, tags, imagen_url, is_active } = req.body;

    try {
        const old = await db.query('SELECT * FROM products WHERE id = $1', [id]);
        if (old.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

        const fields = []; const params = []; let i = 1;
        const add = (col, val) => { if (val !== undefined) { fields.push(`${col} = $${i++}`); params.push(val); } };

        add('titulo',            titulo);
        add('descripcion',       descripcion);
        add('descripcion_corta', descripcion_corta);
        add('precio_con_igv',    precio_con_igv !== undefined ? parseFloat(precio_con_igv) : undefined);
        add('precio_sin_igv',    precio_sin_igv !== undefined ? parseFloat(precio_sin_igv) : undefined);
        add('stock_general',     stock_general !== undefined  ? parseInt(stock_general) : undefined);
        add('categoria',         categoria);
        add('tipo_producto',     tipo_producto);
        add('imagen_url',        imagen_url);
        add('is_active',         is_active);
        if (Array.isArray(tags)) { fields.push(`tags = $${i++}`); params.push(tags); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(id);
        const result = await db.query(`UPDATE products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, params);

        await db.query(`
            INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, performed_by)
            VALUES ('product', $1, 'update', $2, $3, $4)
        `, [id, JSON.stringify(old.rows[0]), JSON.stringify(result.rows[0]), req.user.id]);

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/products/:id  — Soft delete
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
