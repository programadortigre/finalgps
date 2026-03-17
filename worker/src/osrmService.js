const axios = require('axios');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

const OSRM_URL = process.env.OSRM_URL || 'http://osrm:5000';

/**
 * Detect gaps and interpolate points if necessary.
 * Rule: time_gap > 15s AND distance > 40m
 */
function interpolateGaps(points) {
    if (points.length < 2) return points;
    
    const result = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i+1];
        result.push(p1);
        
        const timeGap = (p2.timestamp - p1.timestamp) / 1000;
        const dist = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        
        if (timeGap > 15 && dist > 40) {
            logger.info(`[OSRM] Gap detected: ${timeGap.toFixed(1)}s / ${dist.toFixed(1)}m. Interpolating...`);
            // Simple linear interpolation
            const numPoints = Math.min(Math.floor(timeGap / 10), 100); // 1 punto cada 10s, max 100
            for (let j = 1; j <= numPoints; j++) {
                const ratio = j / (numPoints + 1);
                result.push({
                    lat: p1.lat + (p2.lat - p1.lat) * ratio,
                    lng: p1.lng + (p2.lng - p1.lng) * ratio,
                    timestamp: Math.floor(p1.timestamp + (p2.timestamp - p1.timestamp) * ratio),
                    accuracy: (p1.accuracy + p2.accuracy) / 2,
                    speed: p1.speed, // Keep last speed since we don't know
                    heading: p1.heading,
                    is_interpolated: true
                });
            }
        }
    }
    result.push(points[points.length - 1]);
    return result;
}

/**
 * Call OSRM /match endpoint
 */
async function matchSegment(points) {
    if (points.length < 2) return null;

    const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
    const timestamps = points.map(p => Math.floor(p.timestamp / 1000)).join(';');
    const radiuses = points.map(p => Math.max(5, p.accuracy || 15)).join(';');

    const url = `${OSRM_URL}/match/v1/driving/${coords}?geometries=polyline6&overview=full&annotations=true&steps=false&timestamps=${timestamps}&radiuses=${radiuses}`;

    let retries = 2;
    while (retries >= 0) {
        try {
            const response = await axios.get(url, { timeout: 5000 });
            if (response.data.code === 'Ok') {
                return response.data;
            } else {
                logger.warn(`[OSRM] Match failed with code: ${response.data.code}`);
                return null;
            }
        } catch (err) {
            logger.error(`[OSRM] Request error (retries left: ${retries}): ${err.message}`);
            if (retries === 0) return null;
            retries--;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
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

module.exports = { interpolateGaps, matchSegment };
