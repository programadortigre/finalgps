const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');
const authenticateToken = require('../middleware/auth');

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
    const { name, address, lat, lng, phone, metadata = {} } = req.body;
    
    if (!name || !lat || !lng) {
        return res.status(400).json({ error: 'Missing required fields: name, lat, lng' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO customers (name, address, geom, phone, metadata)
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6)
            RETURNING id, name, address, phone, metadata, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lng
        `, [name, address, lat, lng, phone, JSON.stringify(metadata)]);
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
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
    const { name, address, lat, lng, phone, metadata } = req.body;

    try {
        let updateQuery = 'UPDATE customers SET ';
        const params = [];
        let i = 1;

        if (name) { updateQuery += `name = $${i++}, `; params.push(name); }
        if (address) { updateQuery += `address = $${i++}, `; params.push(address); }
        if (phone) { updateQuery += `phone = $${i++}, `; params.push(phone); }
        if (metadata) { updateQuery += `metadata = $${i++}, `; params.push(JSON.stringify(metadata)); }
        
        if (lat !== undefined && lng !== undefined) {
             updateQuery += `geom = ST_SetSRID(ST_MakePoint($${i+1}, $${i}), 4326)::geography, `;
             params.push(lat);
             params.push(lng);
             i += 2;
        }

        // Remove last comma and space
        updateQuery = updateQuery.trim().replace(/,$/, '');
        updateQuery += ` WHERE id = $${i} RETURNING id, name, address, phone, metadata, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lng`;
        params.push(id);

        const result = await pool.query(updateQuery, params);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
        
        res.json(result.rows[0]);
    } catch (err) {
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
