/**
 * Douglas-Peucker Algorithm
 * Simplifica polylines: 10,000 puntos → 150-200 puntos
 * Mantiene la forma exacta del recorrido
 */
export const simplifyPolyline = (points, tolerance = 0.0008) => {
  if (!points || points.length <= 2) return points || [];

  const dmax = Math.max(
    ...points.map((_, i) => {
      if (i === 0 || i === points.length - 1) return 0;
      return perpendicularDistance(
        points[i],
        points[0],
        points[points.length - 1]
      );
    })
  );

  if (dmax > tolerance) {
    const index = points.findIndex(
      (_, i) =>
        i > 0 &&
        i < points.length - 1 &&
        perpendicularDistance(
          points[i],
          points[0],
          points[points.length - 1]
        ) === dmax
    );

    if (index > 0) {
      const left = simplifyPolyline(points.slice(0, index + 1), tolerance);
      const right = simplifyPolyline(points.slice(index), tolerance);
      return left.slice(0, -1).concat(right);
    }
  }

  return [points[0], points[points.length - 1]];
};

/**
 * Calcula distancia perpendicular de punto a línea
 */
const perpendicularDistance = (point, lineStart, lineEnd) => {
  const px = point.lat || point[0];
  const py = point.lng || point[1];
  const x1 = lineStart.lat || lineStart[0];
  const y1 = lineStart.lng || lineStart[1];
  const x2 = lineEnd.lat || lineEnd[0];
  const y2 = lineEnd.lng || lineEnd[1];

  const numerator = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2);

  return denominator === 0 ? 0 : numerator / denominator;
};

/**
 * Genera URL de Google Maps
 */
export const formatGoogleMapsUrl = (lat, lng) => {
  return `https://www.google.com/maps?q=${parseFloat(lat).toFixed(6)},${parseFloat(lng).toFixed(6)}`;
};

/**
 * Genera URL de Google Maps con ruta completa
 * @param points array de {lat, lng}
 */
export const formatGoogleMapsRoute = (points) => {
  if (!points || points.length === 0) return '';
  
  const start = points[0];
  const end = points[points.length - 1];
  const waypoints = points.slice(1, -1);
  
  let url = `https://www.google.com/maps/dir/${start.lat},${start.lng}`;
  
  if (waypoints.length > 0) {
    waypoints.forEach(wp => {
      url += `/${wp.lat},${wp.lng}`;
    });
  }
  
  url += `/${end.lat},${end.lng}`;
  
  return url;
};
