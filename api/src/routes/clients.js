const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db/postgres');

// Middleware to ensure admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

/// ============================================================================
/// ENDPOINT: POST / - Registrar nuevo cliente
/// ============================================================================
router.post('/', auth, isAdmin, async (req, res) => {
    const { name, address, lat, lng, expected_visit_time } = req.body;

    if (!name || !lat || !lng) {
        return res.status(400).json({ error: 'Name, latitude and longitude are required' });
    }

    try {
        const result = await db.query(`
            INSERT INTO clients (name, address, geom, expected_visit_time)
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
            RETURNING id, name
        `, [name, address, lng, lat, expected_visit_time || 5]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[ERROR] Failed to create client:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/// ============================================================================
/// ENDPOINT: GET / - Listar clientes
/// ============================================================================
router.get('/', auth, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT id, name, address, ST_X(geom::geometry) as lng, ST_Y(geom::geometry) as lat, expected_visit_time
            FROM clients
            ORDER BY name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[ERROR] Failed to fetch clients:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
