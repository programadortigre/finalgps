const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db/postgres');

// Get all employees (for admin)
router.get('/employees', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    try {
        const result = await db.query('SELECT id, name, email FROM employees WHERE role = \'employee\'');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get trips for a specific date and employee
router.get('/', auth, async (req, res) => {
    const { employeeId, date } = req.query; // date format: YYYY-MM-DD
    const userId = req.user.role === 'admin' ? employeeId : req.user.id;

    if (!userId || !date) {
        return res.status(400).json({ error: 'employeeId and date are required' });
    }

    try {
        const result = await db.query(`
      SELECT id, start_time, end_time, distance_meters 
      FROM trips 
      WHERE employee_id = $1 
      AND DATE(start_time) = $2
      ORDER BY start_time DESC
    `, [userId, date]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get details of a single trip (route + stops)
router.get('/:id', auth, async (req, res) => {
    const tripId = req.params.id;

    try {
        // 1. Get trip info
        const tripResult = await db.query('SELECT * FROM trips WHERE id = $1', [tripId]);
        if (tripResult.rows.length === 0) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        // 2. Get route points as GeoJSON
        const pointsResult = await db.query(`
      SELECT latitude as lat, longitude as lng, speed, accuracy, timestamp
      FROM locations 
      WHERE trip_id = $1 
      ORDER BY timestamp ASC
    `, [tripId]);

        // 3. Get stops
        const stopsResult = await db.query(`
      SELECT latitude as lat, longitude as lng, start_time, end_time, duration_seconds
      FROM stops 
      WHERE trip_id = $1 
      ORDER BY start_time ASC
    `, [tripId]);

        res.json({
            trip: tripResult.rows[0],
            points: pointsResult.rows,
            stops: stopsResult.rows
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
