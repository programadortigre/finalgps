const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const db = require('../db/postgres');

// Helper: admin-only guard
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
};

// GET /api/employees — list all employees
router.get('/', auth, adminOnly, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, name, email, role, created_at FROM employees ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/employees — create a new employee/vendor
router.post('/', auth, adminOnly, async (req, res) => {
    const { name, email, password, role = 'employee' } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'name, email and password are required' });
    }

    if (!['admin', 'employee'].includes(role)) {
        return res.status(400).json({ error: 'role must be admin or employee' });
    }

    try {
        const exists = await db.query('SELECT id FROM employees WHERE email = $1', [email]);
        if (exists.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await db.query(
            `INSERT INTO employees (name, email, password_hash, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, email, role, created_at`,
            [name, email, hash, role]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/employees/:id — update employee
router.put('/:id', auth, adminOnly, async (req, res) => {
    const { name, email, password, role } = req.body;
    const { id } = req.params;

    try {
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            await db.query(
                'UPDATE employees SET name=$1, email=$2, password_hash=$3, role=$4 WHERE id=$5',
                [name, email, hash, role, id]
            );
        } else {
            await db.query(
                'UPDATE employees SET name=$1, email=$2, role=$3 WHERE id=$4',
                [name, email, role, id]
            );
        }
        const updated = await db.query('SELECT id, name, email, role, created_at FROM employees WHERE id=$1', [id]);
        res.json(updated.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/employees/:id — remove an employee
router.delete('/:id', auth, adminOnly, async (req, res) => {
    const { id } = req.params;
    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    try {
        await db.query('DELETE FROM employees WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
