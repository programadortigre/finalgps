async function detectStops(client, tripId, employeeId) {
    const DISTANCE_THRESHOLD = 15;      // ⚡ REDUCIDO a 15 metros (fue 20m) - mejor precisión
    const SPEED_THRESHOLD = 2.0 / 3.6;  // 2 km/h en m/s
    const MIN_DURATION_MS = 25 * 1000;  // ⚡ REDUCIDO a 25 segundos (fue 60s) - detecta paradas cortas
    const MAX_SPREAD = 20;              // ⚡ ACTIVO: máxima dispersión del cluster (fue 25)
    const MIN_SPEED_KMH = 1.5;          // ⚡ NUEVO: velocidad máxima para considerar parada

    // ✅ Usar puntos MATCHED si existen (ya están suavizados), si no, usar RAW
    const matchedCount = await client.query('SELECT count(*) FROM matched_locations WHERE trip_id = $1', [tripId]);
    let query;
    if (parseInt(matchedCount.rows[0].count) > 0) {
        query = 'SELECT id, latitude, longitude, speed, timestamp FROM matched_locations WHERE trip_id = $1 ORDER BY timestamp ASC';
    } else {
        query = 'SELECT id, latitude, longitude, speed, timestamp FROM locations WHERE trip_id = $1 ORDER BY timestamp ASC';
    }

    const res = await client.query(query, [tripId]);

    const points = res.rows;
    if (points.length < 3) {
        // ⚡ REDUCIDO de 5 a 3 puntos mínimos - detecta paradas con pocos datos
        return;
    }

    // ✅ Eliminar paradas previas para recalcular desde cero
    await client.query('DELETE FROM stops WHERE trip_id = $1', [tripId]);

    // ⚡ ALGORITMO MEJORADO: Agrupar por proximidad con validación de velocidad
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
                center: { lat: p.latitude, lng: p.longitude },
                maxDistance: 0
            };
        } else {
            // Calcular distancia al centro del cluster actual
            const dist = haversineDistance(
                currentCluster.center.lat,
                currentCluster.center.lng,
                p.latitude,
                p.longitude
            );

            // ⚡ NUEVA VALIDACIÓN: verificar dispersión máxima del cluster
            if (dist <= DISTANCE_THRESHOLD && dist <= MAX_SPREAD) {
                // Punto pertenece al cluster, agregarlo
                currentCluster.points.push(p);
                currentCluster.maxDistance = Math.max(currentCluster.maxDistance, dist);

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
                    center: { lat: p.latitude, lng: p.longitude },
                    maxDistance: 0
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

    // ⚡ FILTRAR CLUSTERS: validar duración, velocidad y coherencia
    let stopsCount = 0;

    for (const cluster of clusters) {
        const duration = cluster.endTime - cluster.startTime;

        // ⚡ Validación 1: Duración mínima (25 segundos)
        if (duration < MIN_DURATION_MS) {
            continue;
        }

        // ⚡ Validación 2: Velocidad promedio muy baja (indicador de parada)
        const avgSpeed = cluster.points.reduce((sum, p) => sum + (p.speed || 0), 0) / cluster.points.length;
        const avgSpeedKmh = avgSpeed * 3.6;
        if (avgSpeedKmh > MIN_SPEED_KMH) {
            console.log(
                `[STOP-SKIP] Trip ${tripId}: cluster rechazado por velocidad alta (${avgSpeedKmh.toFixed(1)} km/h)`
            );
            continue;
        }

        // ⚡ Validación 3: Dispersión del cluster dentro de límite
        if (cluster.maxDistance > MAX_SPREAD) {
            console.log(
                `[STOP-SKIP] Trip ${tripId}: cluster rechazado por dispersión (${cluster.maxDistance.toFixed(1)}m > ${MAX_SPREAD}m)`
            );
            continue;
        }

        // ✅ CLUSTER VÁLIDO: Insertar parada en BD
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
                `en (${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}) - ${cluster.points.length} puntos, ` +
                `vel.prom: ${avgSpeedKmh.toFixed(1)} km/h, disp: ${cluster.maxDistance.toFixed(1)}m`
            );
        } catch (err) {
            console.error(`[ERROR] Failed to insert stop for trip ${tripId}:`, err.message);
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
