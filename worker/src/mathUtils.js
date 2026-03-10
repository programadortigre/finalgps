/**
 * Mathematical utilities for GPS calculations.
 */

/**
 * Calculates the distance between two points using the Haversine formula.
 * @param {number} lat1 Latitude of point 1
 * @param {number} lon1 Longitude of point 1
 * @param {number} lat2 Latitude of point 2
 * @param {number} lon2 Longitude of point 2
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Calculates the speed between two GPS points.
 * @param {object} p1 Point 1 {lat, lng, timestamp}
 * @param {object} p2 Point 2 {lat, lng, timestamp}
 * @returns {number} Speed in km/h
 */
function calculateSpeed(p1, p2) {
    const distance = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    const timeInHours = Math.abs(p2.timestamp - p1.timestamp) / (1000 * 3600);

    if (timeInHours === 0) return 0;
    return (distance / 1000) / timeInHours;
}

module.exports = {
    haversineDistance,
    calculateSpeed
};
