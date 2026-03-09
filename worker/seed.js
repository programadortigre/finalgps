const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'tracking',
    port: process.env.POSTGRES_PORT || 5432
});

const EMP_ID = 3; // Fernando

function getRandomOffset() {
    return (Math.random() - 0.5) * 0.002;
}

// Haversine distance in meters
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function seedData(daysAgo) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create date for X days ago at 8:00 AM
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        date.setHours(8, 0, 0, 0);

        // End time at 5:00 PM
        const endDate = new Date(date);
        endDate.setHours(17, 0, 0, 0);

        // Create trip
        const tripRes = await client.query(`
            INSERT INTO trips (employee_id, start_time, end_time, is_active, created_at)
            VALUES ($1, $2, $3, false, $2)
            RETURNING id
        `, [EMP_ID, date.toISOString(), endDate.toISOString()]);

        const tripId = tripRes.rows[0].id;

        // Generate points and stops starting in Lima Cercado
        let currentLat = -12.0450;
        let currentLng = -77.0311;

        let currentTime = new Date(date);
        let totalDistance = 0;

        console.log(`Generating data for ${date.toDateString()} (Trip ${tripId})...`);

        let points = [];
        let stops = [];

        // Generate points every 30 seconds
        while (currentTime < endDate) {
            let isStop = false;
            let stopDuration = 0;

            // 5% chance of a stop lasting 15-30 minutes during the typical workday
            if (Math.random() < 0.005 && currentTime.getHours() > 9 && currentTime.getHours() < 16) {
                isStop = true;
                stopDuration = Math.floor(Math.random() * 15 + 15) * 60; // 15-30 mins in secs
            }

            if (isStop) {
                // Record a stop
                const stopEndTime = new Date(currentTime.getTime() + stopDuration * 1000);
                stops.push({
                    lat: currentLat,
                    lng: currentLng,
                    start_time: new Date(currentTime),
                    end_time: stopEndTime,
                    duration_seconds: stopDuration
                });

                // Add jitter points during stop
                let stopTime = new Date(currentTime);
                while (stopTime < stopEndTime) {
                    points.push({
                        lat: currentLat + getRandomOffset() * 0.1, // tiny jitter
                        lng: currentLng + getRandomOffset() * 0.1,
                        speed: Math.random(),
                        timestamp: stopTime.getTime(),
                        time_obj: new Date(stopTime)
                    });
                    stopTime.setSeconds(stopTime.getSeconds() + 30);
                }

                currentTime = stopEndTime;
            } else {
                // Moving towards south/east randomly
                const moveLat = -0.0005 + getRandomOffset(); // mostly south
                const moveLng = Math.random() < 0.3 ? -0.0002 : 0.0002; // random east/west

                const nextLat = currentLat + moveLat;
                const nextLng = currentLng + moveLng;

                const dist = getDistance(currentLat, currentLng, nextLat, nextLng);
                totalDistance += dist;

                // Speed in m/s (approx distance per 30s)
                const speed = dist / 30;

                currentLat = nextLat;
                currentLng = nextLng;

                points.push({
                    lat: currentLat,
                    lng: currentLng,
                    speed: speed * 3.6, // km/h
                    timestamp: currentTime.getTime(),
                    time_obj: new Date(currentTime)
                });

                currentTime.setSeconds(currentTime.getSeconds() + 30);
            }
        }

        // Insert points into DB
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            await client.query(`
                INSERT INTO locations (trip_id, employee_id, latitude, longitude, speed, accuracy, timestamp, created_at, geom) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
                ON CONFLICT (employee_id, timestamp) DO NOTHING
            `, [tripId, EMP_ID, p.lat, p.lng, p.speed, 10, p.timestamp, p.time_obj.toISOString()]);
        }

        // Insert stops into DB
        for (let i = 0; i < stops.length; i++) {
            const s = stops[i];
            await client.query(`
                INSERT INTO stops (trip_id, employee_id, latitude, longitude, start_time, end_time, duration_seconds, geom)
                VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
            `, [tripId, EMP_ID, s.lat, s.lng, s.start_time.toISOString(), s.end_time.toISOString(), s.duration_seconds]);
        }

        // Update trip distance
        await client.query(`UPDATE trips SET distance_meters = $1 WHERE id = $2`, [totalDistance, tripId]);

        await client.query('COMMIT');
        console.log(`Success! Inserted ${points.length} points and ${stops.length} stops. Total distance: ${(totalDistance / 1000).toFixed(2)} km.`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error seeding data:', e);
    } finally {
        client.release();
    }
}

async function main() {
    // Generate data for 1 day ago and 2 days ago
    await seedData(1);
    await seedData(2);
    await pool.end();
}

main().catch(console.error);
