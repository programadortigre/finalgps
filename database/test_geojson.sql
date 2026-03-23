-- Test ST_GeomFromGeoJSON
SELECT ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[-77.04,-12.04],[-77.03,-12.04],[-77.03,-12.05],[-77.04,-12.04]]]}'::text)::geography;

-- Test que funciona en CASE WHEN
SELECT CASE 
  WHEN '{"type":"Polygon","coordinates":[[[-77.04,-12.04],[-77.03,-12.04],[-77.03,-12.05],[-77.04,-12.04]]]}'::text IS NOT NULL 
  THEN ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[-77.04,-12.04],[-77.03,-12.04],[-77.03,-12.05],[-77.04,-12.04]]]}'::text)::geography 
  ELSE NULL::geography 
END;
