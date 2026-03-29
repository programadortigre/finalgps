const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');
const db = require('../db/postgres');
const authenticateToken = require('../middleware/auth');

/**
 * GET /api/customers/nearby
 * Encuentra clientes dentro del radio configurado (GEOCERCA_RADIO_METROS).
 * Usado por la APK para autorelleno de cliente al crear pedido.
 * ?lat=X&lng=Y&radius=100 (radius en metros, fallback a Settings)
 */
router.get('/nearby', authenticateToken, async (req, res) => {
    const { lat, lng, radius } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat y lng son requeridos.' });

    try {
        // Leer radio desde settings si no viene en query
        let searchRadius = parseInt(radius) || 100;
        if (!radius) {
            const radiusSetting = await db.query(
                `SELECT value FROM system_settings WHERE key = 'GEOCERCA_RADIO_METROS'`
            );
            if (radiusSetting.rows[0]) searchRadius = parseInt(radiusSetting.rows[0].value);
        }

        // Leer si se permite historial del cliente
        const histSetting = await db.query(
            `SELECT value FROM system_settings WHERE key = 'PERMITIR_HISTORIAL_CLIENTE'`
        );
        const showHistory = histSetting.rows[0]?.value === 'true';

        const result = await pool.query(`
            SELECT
                c.id, c.name, c.address, c.phone,
                ST_Y(c.geom::geometry) AS lat,
                ST_X(c.geom::geometry) AS lng,
                ST_AsGeoJSON(c.geofence)::json AS geofence,
                ST_Distance(c.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) AS distance_m
            FROM customers c
            WHERE c.active = TRUE
            AND ST_DWithin(
                c.geom::geography,
                ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,
                $3
            )
            ORDER BY distance_m ASC
            LIMIT 10
        `, [parseFloat(lat), parseFloat(lng), searchRadius]);

        const customers = result.rows;

        // Si está habilitado, añadir últimos 5 pedidos de cada cliente
        if (showHistory && customers.length > 0) {
            const ids = customers.map(c => c.id);
            const histResult = await db.query(`
                SELECT o.customer_id, o.id, o.status, o.total_con_igv, o.created_at
                FROM orders o
                WHERE o.customer_id = ANY($1::int[])
                ORDER BY o.created_at DESC
            `, [ids]);

            const histMap = {};
            for (const row of histResult.rows) {
                if (!histMap[row.customer_id]) histMap[row.customer_id] = [];
                if (histMap[row.customer_id].length < 5) histMap[row.customer_id].push(row);
            }
            for (const c of customers) {
                c.pedidos_recientes = histMap[c.id] || [];
            }
        }

        res.json({ customers, radius: searchRadius });
    } catch (err) {
        console.error('[Customers/nearby] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/customers
 * List all customers with their VISIT STATUS for today.
 */
router.get('/', authenticateToken, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const result = await pool.query(`
            SELECT c.id, c.name, c.address, c.phone, c.metadata,
                   ST_Y(c.geom::geometry) as lat, 
                   ST_X(c.geom::geometry) as lng,
                   ST_AsGeoJSON(c.geofence)::json as geofence,
                   c.min_visit_minutes,
                   c.created_at,
                   v.status as visit_status,
                   v.arrived_at,
                   v.left_at
            FROM customers c
            LEFT JOIN visits v ON (v.customer_id = c.id AND v.date = $1)
            ORDER BY c.name ASC
        `, [today]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/customers
 * Create a single customer
 */
router.post('/', authenticateToken, async (req, res) => {
    const { name, address, lat, lng, phone, min_visit_minutes = 5, geofence, metadata = {} } = req.body;
    
    if (!name || !lat || !lng) {
        return res.status(400).json({ error: 'Missing required fields: name, lat, lng' });
    }

    try {
        console.log('[API] Creating customer:', { name, address, lat, lng, geofence: !!geofence });
        const result = await pool.query(`
            INSERT INTO customers (name, address, geom, phone, min_visit_minutes, geofence, metadata)
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6, 
                    CASE WHEN $7::text IS NOT NULL THEN ST_GeomFromGeoJSON($7::text)::geography ELSE NULL::geography END, 
                    $8::jsonb)
            RETURNING id, name, address, phone, min_visit_minutes, ST_AsGeoJSON(geofence)::json as geofence, metadata, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lng
        `, [name, address, lat, lng, phone, min_visit_minutes, geofence ? JSON.stringify(geofence) : null, JSON.stringify(metadata)]);
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[API] Error creating customer:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/customers/bulk
 * Import multiple customers from JSON array
 */
router.post('/bulk', authenticateToken, async (req, res) => {
    const customers = req.body; // Expects array
    if (!Array.isArray(customers)) return res.status(400).json({ error: 'Body must be an array' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = [];
        for (const cust of customers) {
            const { name, address, lat, lng, phone, metadata = {} } = cust;
            if (!name || !lat || !lng) continue;

            const res = await client.query(`
                INSERT INTO customers (name, address, geom, phone, metadata)
                VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6)
                RETURNING id
            `, [name, address, lat, lng, phone, JSON.stringify(metadata)]);
            inserted.push(res.rows[0]);
        }
        await client.query('COMMIT');
        res.json({ success: true, count: inserted.length });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/customers/:id
 * Update customer data or location
 */
router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, address, lat, lng, phone, min_visit_minutes, geofence, metadata } = req.body;

    try {
        let updateQuery = 'UPDATE customers SET ';
        const params = [];
        let i = 1;

        if (name) { updateQuery += `name = $${i++}, `; params.push(name); }
        if (address) { updateQuery += `address = $${i++}, `; params.push(address); }
        if (phone) { updateQuery += `phone = $${i++}, `; params.push(phone); }
        if (min_visit_minutes !== undefined) { updateQuery += `min_visit_minutes = $${i++}, `; params.push(min_visit_minutes); }
        if (metadata) { updateQuery += `metadata = $${i++}::jsonb, `; params.push(JSON.stringify(metadata)); }
        
        if (geofence !== undefined) {
             updateQuery += `geofence = CASE WHEN $${i}::text IS NOT NULL THEN ST_GeomFromGeoJSON($${i}::text)::geography ELSE NULL::geography END, `;
             params.push(geofence ? JSON.stringify(geofence) : null);
             i++;
        }

        if (lat !== undefined && lng !== undefined) {
             updateQuery += `geom = ST_SetSRID(ST_MakePoint($${i+1}, $${i}), 4326)::geography, `;
             params.push(lat);
             params.push(lng);
             i += 2;
        }

        // Remove last comma and space
        updateQuery = updateQuery.trim().replace(/,$/, '');
        updateQuery += ` WHERE id = $${i} RETURNING id, name, address, phone, min_visit_minutes, ST_AsGeoJSON(geofence)::json as geofence, metadata, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lng`;
        params.push(id);

        const result = await pool.query(updateQuery, params);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[API] Error updating customer:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/customers/:id
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM customers WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
        res.json({ success: true, id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
