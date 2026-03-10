async function detectStops(client, tripId, employeeId) {
    const SPEED_THRESHOLD = 1.0;        // km/h - velocidad máxima para parada
    const MIN_DURATION_MS = 3 * 60 * 1000; // 3 minutos mínimo
    const DISTANCE_THRESHOLD = 20;      // metros - máxima distancia para agrupar

    // Obtener todos los puntos ordenados
    const res = await client.query(
        'SELECT id, latitude, longitude, speed, accuracy, timestamp FROM locations WHERE trip_id = $1 ORDER BY timestamp ASC',
        [tripId]
    );

    const points = res.rows;
    if (points.length < 2) return;

    // ✅ PASO 1: Eliminar paradas existentes para este trip (recalcular siempre)
    await client.query('DELETE FROM stops WHERE trip_id = $1', [tripId]);

    // ✅ PASO 2: Agrupar puntos de parada
    let currentStop = null;
    const stops = [];

    for (let i = 0; i < points.length; i++) {
        const p = points[i];

        // Si punto está parado (velocidad muy baja)
        if (p.speed < SPEED_THRESHOLD) {
            if (!currentStop) {
                // Iniciar nueva parada
                currentStop = {
                    startIdx: i,
                    startTime: p.timestamp,
                    lat: p.latitude,
                    lng: p.longitude,
                    points: [p],
                };
            } else {
                // Verificar si el punto está cerca (filtro de precisión)
                const dist = haversineDistance(
                    currentStop.lat, currentStop.lng,
                    p.latitude, p.longitude
                );

                if (dist <= DISTANCE_THRESHOLD) {
                    // Pertenece a la misma parada
                    currentStop.points.push(p);
                } else {
                    // Punto lejano pero lento = nueva parada
                    stops.push(currentStop);
                    currentStop = {
                        startIdx: i,
                        startTime: p.timestamp,
                        lat: p.latitude,
                        lng: p.longitude,
                        points: [p],
                    };
                }
            }
        } else {
            // Punto en movimiento
            if (currentStop) {
                // Cerrar parada
                currentStop.endTime = points[i - 1].timestamp;
                currentStop.endLat = points[i - 1].latitude;
                currentStop.endLng = points[i - 1].longitude;
                stops.push(currentStop);
                currentStop = null;
            }
        }
    }

    // Si termina con una parada activa
    if (currentStop) {
        currentStop.endTime = points[points.length - 1].timestamp;
        currentStop.endLat = points[points.length - 1].latitude;
        currentStop.endLng = points[points.length - 1].longitude;
        stops.push(currentStop);
    }

    // ✅ PASO 3: Guardar paradas válidas (duración >= MIN_DURATION)
    for (const stop of stops) {
        const duration = stop.endTime - stop.startTime;

        // Solo guardar si cumple duración mínima
        if (duration >= MIN_DURATION_MS) {
            const durationSeconds = Math.floor(duration / 1000);
            
            // Usar promedio de coordenadas para mejor precisión
            const avgLat = stop.points.reduce((sum, p) => sum + p.latitude, 0) / stop.points.length;
            const avgLng = stop.points.reduce((sum, p) => sum + p.longitude, 0) / stop.points.length;

            await client.query(
                `INSERT INTO stops (trip_id, employee_id, latitude, longitude, start_time, end_time, duration_seconds, geom)
                 VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($6/1000.0), $7, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)`,
                [tripId, employeeId, avgLat, avgLng, stop.startTime, stop.endTime, durationSeconds]
            );

            console.log(
                `[STOP] Trip ${tripId}: parada de ${(duration / 1000 / 60).toFixed(1)} min ` +
                `en (${avgLat.toFixed(4)}, ${avgLng.toFixed(4)}) con ${stop.points.length} puntos`
            );
        }
    }

    console.log(`[STOPS] Trip ${tripId}: detectadas ${stops.filter(s => (s.endTime - s.startTime) >= MIN_DURATION_MS).length} paradas válidas`);
}

/// Calcular distancia en metros entre dos puntos usando Haversine
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
