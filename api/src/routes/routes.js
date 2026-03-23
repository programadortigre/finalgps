const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');
const authenticateToken = require('../middleware/auth');

/**
 * GET /api/routes/me/route
 * Devuelve la ruta asignada al empleado para hoy con sus clientes y estado de visita.
 */
router.get('/me/route', authenticateToken, async (req, res) => {
    let employeeId = req.user.id;
    
    // Si es administrador y especifica un employeeId, lo usamos
    if (req.user.role === 'admin' && req.query.employeeId) {
        employeeId = parseInt(req.query.employeeId);
    }

    const today = new Date().toISOString().split('T')[0];

    try {
        // 1. Obtener la asignación y la ruta base
        const assignmentRes = await pool.query(`
            SELECT ra.id as assignment_id, ra.status as assignment_status,
                   r.id as route_id, r.name as route_name, r.optimized_json_cache
            FROM route_assignments ra
            INNER JOIN routes r ON ra.route_id = r.id
            WHERE ra.employee_id = $1 AND ra.date = $2
            LIMIT 1
        `, [employeeId, today]);

        if (assignmentRes.rows.length === 0) {
            return res.status(404).json({ message: 'No tienes una ruta asignada para hoy.' });
        }

        const route = assignmentRes.rows[0];

        // 2. Obtener los clientes de la ruta y su estado de visita hoy
        const customersRes = await pool.query(`
            SELECT c.id, c.name, c.address, 
                   ST_Y(c.geom::geometry) as lat, 
                   ST_X(c.geom::geometry) as lng,
                   rc.sort_order,
                   v.status as visit_status,
                   v.arrived_at,
                   v.left_at
            FROM route_customers rc
            INNER JOIN customers c ON rc.customer_id = c.id
            LEFT JOIN visits v ON (v.customer_id = c.id AND v.employee_id = $1 AND v.date = $2)
            WHERE rc.route_id = $3
            ORDER BY rc.sort_order ASC
        `, [employeeId, today, route.route_id]);

        res.json({
            ...route,
            customers: customersRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/routes/me/active-visit
 * Retorna si el empleado tiene una visita "ongoing" en este momento.
 */
router.get('/me/active-visit', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.id, v.customer_id, c.name as customer_name, v.arrived_at
            FROM visits v
            INNER JOIN customers c ON v.customer_id = c.id
            WHERE v.employee_id = $1 AND v.status = 'ongoing'
            ORDER BY v.arrived_at DESC
            LIMIT 1
        `, [req.user.id]);

        res.json(result.rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/routes/assign (Admin)
 */
router.post('/assign', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
    
    const { employee_id, route_id, date } = req.body;
    try {
        const result = await pool.query(`
            INSERT INTO route_assignments (employee_id, route_id, date)
            VALUES ($1, $2, $3)
            ON CONFLICT (employee_id, date) DO UPDATE SET route_id = EXCLUDED.route_id
            RETURNING id
        `, [employee_id, route_id, date || new Date().toISOString().split('T')[0]]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
