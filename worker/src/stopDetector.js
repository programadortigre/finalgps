async function detectStops(client, tripId, employeeId) {
    // Define a stop: Speed < 1.0 km/h for more than 5 minutes
    const SPEED_THRESHOLD = 1.0;
    const TIME_THRESHOLD_MS = 5 * 60 * 1000;

    const res = await client.query(
        'SELECT latitude, longitude, speed, timestamp FROM locations WHERE trip_id = $1 ORDER BY timestamp ASC',
        [tripId]
    );

    const points = res.rows;
    if (points.length < 2) return;

    let stopStart = null;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.speed < SPEED_THRESHOLD) {
            if (!stopStart) stopStart = p;
        } else {
            if (stopStart) {
                const duration = p.timestamp - stopStart.timestamp;
                if (duration >= TIME_THRESHOLD_MS) {
                    await client.query(
                        `INSERT INTO stops (trip_id, employee_id, latitude, longitude, start_time, end_time, duration_seconds, geom)
             VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($6/1000.0), $7, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)`,
                        [tripId, employeeId, stopStart.latitude, stopStart.longitude, stopStart.timestamp, p.timestamp, Math.floor(duration / 1000)]
                    );
                }
                stopStart = null;
            }
        }
    }
}

module.exports = { detectStops };
