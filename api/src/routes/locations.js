const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { locationQueue } = require('../services/queue');
const { getIO } = require('../socket/socket');

router.post('/batch', auth, async (req, res) => {
    const { points } = req.body;
    const employeeId = req.user.id;

    if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({ error: 'Valid points array required' });
    }

    try {
        // Push to processing queue
        await locationQueue.add('process-batch', {
            employeeId,
            points
        });

        // Real-time update for admins (optional: only first point for immediate feedback)
        const io = getIO();
        if (io) {
            const lastPoint = points[points.length - 1];
            io.to('admins').emit('location_update', {
                employeeId,
                name: req.user.name,
                lat: lastPoint.lat,
                lng: lastPoint.lng,
                timestamp: lastPoint.timestamp
            });
        }

        res.status(202).json({ status: 'queued' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to queue locations' });
    }
});

module.exports = router;
