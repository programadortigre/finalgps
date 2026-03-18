async function detectStops(client, tripId, employeeId) {
    const DISTANCE_THRESHOLD = 15;      // metros para asignar un punto al cluster actual
    const MIN_DURATION_MS = 20 * 1000;  // FIX: 20s (era 25s) — capta paradas más cortas
    const MAX_SPREAD = 20;              // máxima dispersión del cluster en metros
    const MIN_SPEED_KMH = 3.5;          // velocidad promedio máxima para considerar parada

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

        // FIX: Recalcular velocidad desde distancia/tiempo entre puntos consecutivos.
        // El campo `speed` heredado puede ser incorrecto si OSRM reposicionó el punto
        // pero el valor de velocidad original permaneció del punto GPS crudo.
        let totalDistM = 0;
        let totalTimeS = 0;
        for (let i = 1; i < cluster.points.length; i++) {
            const pa = cluster.points[i - 1];
            const pb = cluster.points[i];
            totalDistM += haversineDistance(pa.latitude, pa.longitude, pb.latitude, pb.longitude);
            const dt = (parseInt(pb.timestamp) - parseInt(pa.timestamp)) / 1000;
            if (dt > 0) totalTimeS += dt;
        }
        const avgSpeedKmh = totalTimeS > 0 ? (totalDistM / totalTimeS) * 3.6 : 0;

        if (avgSpeedKmh > MIN_SPEED_KMH) {
            console.log(
                `[STOP-SKIP] Trip ${tripId}: cluster rechazado por velocidad (${avgSpeedKmh.toFixed(1)} km/h calculada en ${totalDistM.toFixed(1)}m / ${totalTimeS.toFixed(1)}s)`
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
