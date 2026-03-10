const { haversineDistance, calculateSpeed } = require('./mathUtils');

/**
 * Semantic Classifier for GPS trajectories.
 */
class SemanticClassifier {
    constructor(pool) {
        this.pool = pool;
        // Configuration Constants
        this.EPSILON_METERS = 20;
        this.MIN_POINTS = 4;
        this.DWELL_TIME_THRESHOLD_MS = 2 * 60 * 1000;
        this.VISIT_SCORE_THRESHOLD = 60;
    }

    /**
     * Filters out noisy GPS points.
     * @param {Array} points Array of {lat, lng, speed, accuracy, timestamp}
     * @returns {Array} Filtered points
     */
    filterPoints(points) {
        if (points.length === 0) return [];

        const filtered = [];
        for (let i = 0; i < points.length; i++) {
            const p = points[i];

            // Rule 1: Accuracy > 50m → discard
            if (p.accuracy > 50) continue;

            // Rule 2: Speed > 150 km/h → discard
            if (p.speed * 3.6 > 150) continue;

            if (filtered.length > 0) {
                const prev = filtered[filtered.length - 1];
                const dist = haversineDistance(prev.lat, prev.lng, p.lat, p.lng);
                const timeDiff = (p.timestamp - prev.timestamp) / 1000;

                // Rule 4: Timestamp gap > 5 min -> Reset jump check (to prevent broken speed calculations)
                if (timeDiff <= 300) {
                    // Rule 3: Jumps > 200m in few seconds → discard
                    if (dist > 200 && timeDiff < 5) continue;
                }
            }

            filtered.push(p);
        }
        return filtered;
    }

    /**
     * Simple DBSCAN-style clustering to find dwell points.
     */
    detectClusters(points) {
        const clusters = [];
        const visited = new Set();

        for (let i = 0; i < points.length; i++) {
            if (visited.has(i)) continue;

            const neighbors = this.getNeighbors(i, points);
            if (neighbors.length >= this.MIN_POINTS) {
                const clusterPoints = this.expandCluster(i, neighbors, points, visited);

                const startTime = Math.min(...clusterPoints.map(p => p.timestamp));
                const endTime = Math.max(...clusterPoints.map(p => p.timestamp));
                const durationMs = endTime - startTime;

                if (durationMs >= this.DWELL_TIME_THRESHOLD_MS) {
                    clusters.push({
                        points: clusterPoints,
                        center: this.getCenter(clusterPoints),
                        startTime: new Date(startTime),
                        endTime: new Date(endTime),
                        duration: Math.floor(durationMs / 1000)
                    });
                }
            }
        }
        return clusters;
    }

    getNeighbors(index, points) {
        const neighbors = [];
        const p1 = points[index];
        for (let i = 0; i < points.length; i++) {
            const p2 = points[i];
            if (haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng) <= this.EPSILON_METERS) {
                neighbors.push(i);
            }
        }
        return neighbors;
    }

    expandCluster(index, neighbors, points, visited) {
        const cluster = [points[index]];
        visited.add(index);
        let i = 0;
        while (i < neighbors.length) {
            const neighborIndex = neighbors[i];
            if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                const nextNeighbors = this.getNeighbors(neighborIndex, points);
                if (nextNeighbors.length >= this.MIN_POINTS) {
                    neighbors.push(...nextNeighbors.filter(n => !neighbors.includes(n)));
                }
                cluster.push(points[neighborIndex]);
            }
            i++;
        }
        return cluster;
    }

    getCenter(clusterPoints) {
        const lat = clusterPoints.reduce((sum, p) => sum + p.lat, 0) / clusterPoints.length;
        const lng = clusterPoints.reduce((sum, p) => sum + p.lng, 0) / clusterPoints.length;
        return { lat, lng };
    }

    /**
     * Scoring engine for visit inference.
     */
    async inferVisits(employeeId, clusters) {
        const visits = [];
        for (const cluster of clusters) {
            const { lat, lng } = cluster.center;

            // Find closest client using PostGIS KNN operator (<->)
            const res = await this.pool.query(`
                SELECT id, name, ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist
                FROM clients
                ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                LIMIT 1
            `, [lng, lat]);

            if (res.rows.length === 0) continue;

            const client = res.rows[0];

            // Rule: Matches if distance <= 30m
            if (client.dist <= 30) {
                visits.push({
                    employee_id: employeeId,
                    client_id: client.id,
                    start_time: cluster.startTime,
                    end_time: cluster.endTime,
                    duration: cluster.duration
                });
            }
        }
        return visits;
    }

    /**
     * Determines the state based on refined velocity rules.
     */
    classifyState(point, durationSec = 0, isVisit = false) {
        if (isVisit) return 'VISITA_CLIENTE';

        const speedKmh = point.speed * 3.6;

        if (speedKmh >= 15) return 'EN_RUTA_VEHICULO';
        if (speedKmh >= 4 && speedKmh < 15) return 'MOVIMIENTO_LENTO';
        if (speedKmh >= 1 && speedKmh < 4) return 'EN_RUTA_CAMINANDO';

        // DETENIDO > 10 min -> SIN_MOVIMIENTO
        if (speedKmh < 1) {
            if (durationSec > 600) return 'SIN_MOVIMIENTO';
            return 'DETENIDO';
        }

        return 'SIN_MOVIMIENTO';
    }

    /**
     * Generates state events by grouping points.
     */
    async generateStateEvents(employeeId, tripId, points, visits = []) {
        if (points.length === 0) return;

        const events = [];
        let currentEvent = null;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];

            // Check if point belongs to a visit
            const isVisit = visits.some(v =>
                p.timestamp >= v.start_time.getTime() &&
                p.timestamp <= v.end_time.getTime()
            );

            let state = this.classifyState(p, 0, isVisit);

            if (!currentEvent || currentEvent.state !== state) {
                if (currentEvent) {
                    currentEvent.endTime = new Date(p.timestamp);
                    currentEvent.duration = Math.floor((currentEvent.endTime - currentEvent.startTime) / 1000);

                    // Post-process: DETENIDO > 10 min -> SIN_MOVIMIENTO
                    if (currentEvent.state === 'DETENIDO' && currentEvent.duration > 600) {
                        currentEvent.state = 'SIN_MOVIMIENTO';
                    }

                    events.push(currentEvent);
                }
                currentEvent = {
                    employee_id: employeeId,
                    state: state,
                    startTime: new Date(p.timestamp)
                };
            }

            // Update point state in locations table
            await this.pool.query(
                'UPDATE locations SET state = $1, metadata = $2 WHERE trip_id = $3 AND timestamp = $4',
                [state, JSON.stringify({ speed: p.speed, accuracy: p.accuracy, isVisit }), tripId, p.timestamp]
            );
        }

        if (currentEvent) {
            currentEvent.endTime = new Date(points[points.length - 1].timestamp);
            currentEvent.duration = Math.floor((currentEvent.endTime - currentEvent.startTime) / 1000);
            if (currentEvent.state === 'DETENIDO' && currentEvent.duration > 600) {
                currentEvent.state = 'SIN_MOVIMIENTO';
            }
            events.push(currentEvent);
        }

        // Insert into state_events
        for (const event of events) {
            await this.pool.query(
                'INSERT INTO state_events (employee_id, state, start_time, end_time, duration) VALUES ($1, $2, $3, $4, $5)',
                [event.employee_id, event.state, event.startTime, event.endTime, event.duration]
            );
        }
    }
}

module.exports = SemanticClassifier;
