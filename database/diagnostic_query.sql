-- SCRIPT DE DIAGNÓSTICO: Revisar datos guardados y detectar problemas

-- 1. VIAJES (trips)
SELECT '=== VIAJES HOY ===' as section;
SELECT 
    t.id,
    e.name,
    t.start_time,
    t.end_time,
    t.distance_meters,
    t.is_active,
    (SELECT COUNT(*) FROM locations WHERE trip_id = t.id) as point_count,
    (SELECT COUNT(*) FROM stops WHERE trip_id = t.id) as stop_count
FROM trips t
INNER JOIN employees e ON t.employee_id = e.id
WHERE DATE(t.start_time) = CURRENT_DATE
ORDER BY t.start_time DESC;

-- 2. UBICACIONES (Últimas 50)
SELECT '=== ÚLTIMAS 50 UBICACIONES ===' as section;
SELECT 
    l.id,
    e.name as employee,
    l.latitude,
    l.longitude,
    l.accuracy,
    l.speed,
    l.state,
    l.timestamp,
    l.created_at
FROM locations l
INNER JOIN employees e ON l.employee_id = e.id
WHERE DATE(l.created_at) = CURRENT_DATE
ORDER BY l.created_at DESC
LIMIT 50;

-- 3. PARADAS (Últimas 20)
SELECT '=== ÚLTIMAS 20 PARADAS ===' as section;
SELECT 
    s.id,
    e.name as employee,
    s.latitude,
    s.longitude,
    s.start_time,
    s.end_time,
    s.duration_seconds,
    FLOOR(s.duration_seconds / 60) as minutes,
    t.id as trip_id
FROM stops s
INNER JOIN trips t ON s.trip_id = t.id
INNER JOIN employees e ON s.employee_id = e.id
WHERE DATE(s.created_at) = CURRENT_DATE
ORDER BY s.created_at DESC
LIMIT 20;

-- 4. ESTADÍSTICAS HOY
SELECT '=== ESTADÍSTICAS HOY ===' as section;
SELECT 
    (SELECT COUNT(DISTINCT employee_id) FROM locations WHERE DATE(created_at) = CURRENT_DATE) as employees_tracked,
    (SELECT COUNT(*) FROM locations WHERE DATE(created_at) = CURRENT_DATE) as total_points,
    (SELECT COUNT(*) FROM trips WHERE DATE(start_time) = CURRENT_DATE) as total_trips,
    (SELECT COUNT(*) FROM stops WHERE DATE(created_at) = CURRENT_DATE) as total_stops,
    (SELECT AVG(accuracy) FROM locations WHERE DATE(created_at) = CURRENT_DATE) as avg_accuracy,
    (SELECT MIN(accuracy) FROM locations WHERE DATE(created_at) = CURRENT_DATE) as min_accuracy,
    (SELECT MAX(accuracy) FROM locations WHERE DATE(created_at) = CURRENT_DATE) as max_accuracy;

-- 5. PROBLEMA: Puntos duplicados o muy juntos (< 5 metros)
SELECT '=== ANÁLISIS DE RUIDO: Puntos duplicados (< 5m) ===' as section;
WITH consecutive_points AS (
    SELECT 
        l1.id as point1_id,
        l2.id as point2_id,
        l1.employee_id,
        e.name,
        l1.latitude as lat1,
        l1.longitude as lng1,
        l2.latitude as lat2,
        l2.longitude as lng2,
        ST_Distance(l1.geom::geography, l2.geom::geography) as distance_m,
        l1.accuracy as acc1,
        l2.accuracy as acc2,
        ABS(EXTRACT(EPOCH FROM (l2.timestamp::timestamp - l1.timestamp::timestamp))) as time_diff_sec
    FROM locations l1
    INNER JOIN locations l2 ON 
        l1.employee_id = l2.employee_id 
        AND l1.id + 1 = l2.id  -- Puntos consecutivos del mismo empleado
    INNER JOIN employees e ON l1.employee_id = e.id
    WHERE DATE(l1.created_at) = CURRENT_DATE
    AND ST_Distance(l1.geom::geography, l2.geom::geography) < 5  -- Menos de 5 metros
)
SELECT * FROM consecutive_points
ORDER BY employee_id, time_diff_sec DESC
LIMIT 30;

-- 6. PROBLEMA: Paradas que deberían haberse detectado (> 60 seg parados)
SELECT '=== ANÁLISIS: Potenciales paradas no detectadas (> 60 seg) ===' as section;
WITH point_clusters AS (
    SELECT 
        l.trip_id,
        e.name,
        ST_ClusterDBSCAN(l.geom::geography, 20) OVER (PARTITION BY l.trip_id ORDER BY l.timestamp) as cluster_id,
        l.timestamp,
        COUNT(*) OVER (PARTITION BY l.trip_id, ST_ClusterDBSCAN(l.geom::geography, 20) OVER (PARTITION BY l.trip_id ORDER BY l.timestamp)) as cluster_size,
        MIN(l.timestamp) OVER (PARTITION BY l.trip_id, ST_ClusterDBSCAN(l.geom::geography, 20) OVER (PARTITION BY l.trip_id ORDER BY l.timestamp)) as cluster_start,
        MAX(l.timestamp) OVER (PARTITION BY l.trip_id, ST_ClusterDBSCAN(l.geom::geography, 20) OVER (PARTITION BY l.trip_id ORDER BY l.timestamp)) as cluster_end
    FROM locations l
    INNER JOIN trips t ON l.trip_id = t.id
    INNER JOIN employees e ON l.employee_id = e.id
    WHERE DATE(l.created_at) = CURRENT_DATE
)
SELECT DISTINCT
    trip_id,
    name as employee,
    cluster_id,
    cluster_size,
    cluster_start,
    cluster_end,
    (EXTRACT(EPOCH FROM (cluster_end - cluster_start)) / 60)::INT as duration_minutes
FROM point_clusters
WHERE cluster_size >= 5  -- Mínimo 5 puntos en el cluster
AND EXTRACT(EPOCH FROM (cluster_end - cluster_start)) >= 60  -- 60+ segundos
ORDER BY trip_id, duration_minutes DESC;

-- 7. Tabla de stops - verificar si se creó correctamente
SELECT '=== ESTRUCTURA TABLA STOPS ===' as section;
SELECT column_name, data_type, is_nullable FROM information_schema.columns 
WHERE table_name = 'stops'
ORDER BY ordinal_position;
