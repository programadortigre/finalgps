async function detectStops(client, tripId, employeeId) {
    const DISTANCE_THRESHOLD = 30;      // metros - máxima dispersión para agrupar
    const MIN_DURATION_MS = 3 * 60 * 1000; // 3 minutos mínimo

    // ✅ Obtener todos los puntos ordenados cronológicamente
    const res = await client.query(
        'SELECT id, latitude, longitude, speed, timestamp FROM locations WHERE trip_id = $1 ORDER BY timestamp ASC',
        [tripId]
    );

    const points = res.rows;
    if (points.length < 5) {
        // Necesitamos al menos 5 puntos para una parada válida
        return;
    }

    // ✅ Eliminar paradas previas para recalcular desde cero
    await client.query('DELETE FROM stops WHERE trip_id = $1', [tripId]);

    // ✅ ALGORITMO: Agrupar por proximidad espacial
    let clusters = [];
    let currentCluster = null;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];

        if (!currentCluster) {
            // Iniciar nuevo cluster
            currentCluster = {
                startIdx: i,
                startTime: p.timestamp,
                points: [p],
                center: { lat: p.latitude, lng: p.longitude }
            };
        } else {
            // Calcular distancia al centro del cluster actual
            const dist = haversineDistance(
                currentCluster.center.lat,
                currentCluster.center.lng,
                p.latitude,
                p.longitude
            );

            if (dist <= DISTANCE_THRESHOLD) {
                // Punto pertenece al cluster, agregarlo
                currentCluster.points.push(p);

                // ✅ Actualizar centro del cluster (centroide dinámico)
                let sumLat = 0, sumLng = 0;
                currentCluster.points.forEach(pt => {
                    sumLat += pt.latitude;
                    sumLng += pt.longitude;
                });
                currentCluster.center.lat = sumLat / currentCluster.points.length;
                currentCluster.center.lng = sumLng / currentCluster.points.length;
            } else {
                // Punto está lejos → cerrar cluster y empezar uno nuevo
                currentCluster.endIdx = i - 1;
                currentCluster.endTime = points[i - 1].timestamp;
                clusters.push(currentCluster);

                currentCluster = {
                    startIdx: i,
                    startTime: p.timestamp,
                    points: [p],
                    center: { lat: p.latitude, lng: p.longitude }
                };
            }
        }
    }

    // ✅ Cerrar el último cluster
    if (currentCluster) {
        currentCluster.endIdx = points.length - 1;
        currentCluster.endTime = points[points.length - 1].timestamp;
        clusters.push(currentCluster);
    }

    // ✅ Filtrar clusters válidos (duración >= MIN_DURATION) y guardar
    let stopsCount = 0;

    for (const cluster of clusters) {
        const duration = cluster.endTime - cluster.startTime;

        // ✅ Solo guardar si duracion es >= 3 minutos
        if (duration >= MIN_DURATION_MS) {
            const durationSeconds = Math.floor(duration / 1000);
            const centerLat = cluster.center.lat;
            const centerLng = cluster.center.lng;

            try {
                await client.query(
                    `INSERT INTO stops (trip_id, employee_id, latitude, longitude, start_time, end_time, duration_seconds, geom)
                     VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($6/1000.0), $7, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)`,
                    [tripId, employeeId, centerLat, centerLng, cluster.startTime, cluster.endTime, durationSeconds]
                );

                stopsCount++;

                console.log(
                    `[STOP] Trip ${tripId}: parada de ${(duration / 1000 / 60).toFixed(1)} min ` +
                    `en (${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}) con ${cluster.points.length} puntos`
                );
            } catch (err) {
                console.error(`[ERROR] Failed to insert stop for trip ${tripId}:`, err.message);
            }
        }
    }

    console.log(`[STOPS] Trip ${tripId}: detectadas ${stopsCount} paradas válidas de ${clusters.length} clusters totales`);
}

/// ✅ Calcular distancia en metros entre dos puntos usando Haversine
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radio de la Tierra en metros
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

module.exports = { detectStops };
