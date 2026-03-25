async function detectStops(client, tripId, employeeId) {
    const MIN_DURATION_MS = 25 * 1000;  // 25s mínimo
    const MAX_SPREAD = 30;              // Aumentado de 20 a 30 para tolerar ruido urbano
    const MAX_JUMP_M = 150;             // Aumentado de 100 a 150 para no romper clusters por un solo punto malo
    const MAX_SPEED_KMH = 4.0;          // Aumentado de 3.5 a 4.0 para capturar paradas con drift

    // 1. Obtener puntos (Siempre usar GPS Raw para que la parada caiga dentro de la tienda, no en la pista)
    const query = `
        SELECT id, latitude, longitude, speed, timestamp 
        FROM locations 
        WHERE trip_id = $1 
        AND quality != 'no_fix' AND source != 'geoip'
        AND (accuracy < 100 OR accuracy IS NULL)
        ORDER BY timestamp ASC
    `;

    const res = await client.query(query, [tripId]);
    let rawPoints = res.rows;

    if (rawPoints.length < 3) return;

    // 2. Pre-procesamiento: Casteo de tipos y Filtro de Saltos (Anti-Jumps)
    const points = [];
    for (let i = 0; i < rawPoints.length; i++) {
        const p = rawPoints[i];
        p.timestamp = parseInt(p.timestamp);
        p.latitude = parseFloat(p.latitude);
        p.longitude = parseFloat(p.longitude);

        if (i > 0) {
            const jumpDist = haversineDistance(rawPoints[i-1].latitude, rawPoints[i-1].longitude, p.latitude, p.longitude);
            if (jumpDist > MAX_JUMP_M) {
                console.log(`[STOP-FILTER] Skipping jump of ${jumpDist.toFixed(1)}m for trip ${tripId}`);
                continue;
            }
        }
        points.push(p);
    }

    // 3. Limpieza de paradas anteriores (solo automáticas)
    await client.query("DELETE FROM stops WHERE trip_id = $1 AND source = 'auto'", [tripId]);

    // 4. Clustering Pro: Agrupación por dispersión máxima
    let clusters = [];
    let currentCluster = null;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];

        if (!currentCluster) {
            currentCluster = {
                startTime: p.timestamp,
                points: [p],
                center: { lat: p.latitude, lng: p.longitude },
                maxDistance: 0
            };
        } else {
            const dist = haversineDistance(currentCluster.center.lat, currentCluster.center.lng, p.latitude, p.longitude);

            if (dist <= MAX_SPREAD) {
                currentCluster.points.push(p);
                currentCluster.maxDistance = Math.max(currentCluster.maxDistance, dist);
                
                // Actualizar centroide dinámico
                let sumLat = 0, sumLng = 0;
                currentCluster.points.forEach(pt => { sumLat += pt.latitude; sumLng += pt.longitude; });
                currentCluster.center.lat = sumLat / currentCluster.points.length;
                currentCluster.center.lng = sumLng / currentCluster.points.length;
            } else {
                currentCluster.endTime = points[i - 1].timestamp;
                clusters.push(currentCluster);
                currentCluster = {
                    startTime: p.timestamp,
                    points: [p],
                    center: { lat: p.latitude, lng: p.longitude },
                    maxDistance: 0
                };
            }
        }
    }
    if (currentCluster) {
        currentCluster.endTime = points[points.length - 1].timestamp;
        clusters.push(currentCluster);
    }

    // 5. Validación PRO por Scoring
    let stopsCount = 0;
    for (const cluster of clusters) {
        const duration = cluster.endTime - cluster.startTime;
        if (duration < MIN_DURATION_MS) continue;

        // Calcular velocidad real (distancia recorrida / tiempo)
        let totalDistM = 0;
        let totalTimeS = 0;
        for (let i = 1; i < cluster.points.length; i++) {
            totalDistM += haversineDistance(cluster.points[i-1].latitude, cluster.points[i-1].longitude, cluster.points[i].latitude, cluster.points[i].longitude);
            const dt = (cluster.points[i].timestamp - cluster.points[i-1].timestamp) / 1000;
            if (dt > 0) totalTimeS += dt;
        }
        const avgSpeedKmh = totalTimeS > 0 ? (totalDistM / totalTimeS) * 3.6 : 0;

        // SISTEMA DE PUNTUACIÓN (SCORE)
        let score = 0;
        if (duration > 40000) score++; // Bonus por duración larga (>40s)
        
        // Regla de Micro-movimientos: si es compacto (<10m), permitimos vel. hasta 6km/h
        const limitSpeed = cluster.maxDistance < 10 ? 6.0 : MAX_SPEED_KMH;
        if (avgSpeedKmh <= limitSpeed) score++;
        
        if (cluster.maxDistance < 15) score++; // Bonus por ser muy estático

        // Confirmar si score >= 2 (Nivel Pro)
        if (score < 2) {
            console.log(`[STOP-SKIP] Trip ${tripId}: Cluster con score ${score} rechazado (vel=${avgSpeedKmh.toFixed(1)}, radio=${cluster.maxDistance.toFixed(1)}m)`);
            continue;
        }

        // 6. Guardar Parada Confirmada
        try {
            await client.query(
                `INSERT INTO stops (trip_id, employee_id, latitude, longitude, start_time, end_time, duration_seconds, source, geom)
                 VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($6/1000.0), $7, 'auto', ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)`,
                [tripId, employeeId, cluster.center.lat, cluster.center.lng, cluster.startTime, cluster.endTime, Math.floor(duration/1000)]
            );
            stopsCount++;
        } catch (err) {
            console.error(`[ERROR] Save stop failed:`, err.message);
        }
    }

    console.log(`[STOPS-PRO] Trip ${tripId}: ${stopsCount} paradas confirmadas via Scoring System.`);
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
