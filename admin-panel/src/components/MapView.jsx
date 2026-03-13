import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';
import Playback from './Playback';
import dayjs from 'dayjs';

// Fix default Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Base Active Icon function to handle dynamic color
const getActiveIcon = (state) => {
    let color = '#94a3b8'; // Default color (Slate/Gray)
    if (state === 'Quieto' || state === 'SIN_MOVIMIENTO') color = '#94a3b8';
    if (state === 'A pie' || state === 'CAMINANDO') color = '#22c55e';
    if (state === 'Lento' || state === 'MOVIMIENTO_LENTO') color = '#f59e0b';
    if (state === 'En auto' || state === 'VEHICULO') color = '#6366f1';

    return L.divIcon({
        className: '',
        html: `<div style="position:relative">
        <div style="background:${color};border:3px solid white;border-radius:50%;width:18px;height:18px;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>
        <div style="position:absolute;top:-2px;left:-2px;width:22px;height:22px;border:2px solid ${color};border-radius:50%;animation:pulse 1.5s infinite;opacity:.5"></div>
      </div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });
};

// Stop icon
const stopIcon = L.divIcon({
    className: '',
    html: `<div style="background:#f59e0b;border:2px solid white;border-radius:50%;width:14px;height:14px;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
});

const FitBounds = ({ positions }) => {
    const map = useMap();
    useEffect(() => {
        if (positions?.length > 0) {
            const b = L.latLngBounds(positions.map(p => [p.lat, p.lng]));
            map.fitBounds(b, { padding: [50, 50] });
        }
    }, [positions]);
    return null;
};

// Componente de controles de zoom personalizado
const ZoomControls = () => {
    const map = useMap();

    const handleZoomIn = () => {
        map.zoomIn();
    };

    const handleZoomOut = () => {
        map.zoomOut();
    };

    return (
        <div style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            zIndex: '999',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
        }}>
            <button
                className="zoom-btn zoom-in"
                title="Acercar (Zoom In)"
                onClick={handleZoomIn}
            >
                +
            </button>
            <button
                className="zoom-btn zoom-out"
                title="Alejar (Zoom Out)"
                onClick={handleZoomOut}
            >
                −
            </button>
        </div>
    );
};

// Reverse geocoding - obtener dirección desde coordenadas (via backend proxy)
const getAddress = async (lat, lng) => {
    try {
        const response = await api.get(`/api/geocoding/reverse?lat=${lat}&lng=${lng}`);
        return response.data.address;
    } catch (e) {
        console.error('Geocoding error:', e);
        return `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
    }
};

const MapView = ({ view, selectedEmployee, activeLocations }) => {
    const [trips, setTrips] = useState([]);
    const [selectedTrip, setTrip] = useState(null);
    const [routeData, setRouteData] = useState(null);
    const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [playbackMode, setPlayback] = useState(false);
    const [addresses, setAddresses] = useState({});

    // Fetch trips when employee/date changes
    useEffect(() => {
        if (view === 'history' && selectedEmployee) {
            setRouteData(null); setTrip(null); setPlayback(false);
            api.get(`/api/trips?employeeId=${selectedEmployee.id}&date=${date}`)
                .then(r => setTrips(r.data))
                .catch(console.error);
        }
    }, [selectedEmployee, date, view]);

    // Cargar direcciones para ubicaciones en vivo
    useEffect(() => {
        if (view === 'live') {
            Object.values(activeLocations).forEach(loc => {
                if (!addresses[`live-${loc.employeeId}`]) {
                    getAddress(loc.lat, loc.lng).then(addr => {
                        setAddresses(prev => ({
                            ...prev,
                            [`live-${loc.employeeId}`]: addr
                        }));
                    });
                }
            });
        }
    }, [view, activeLocations]);

    // Cargar todo el historial del día seleccionado
    const fetchAllTripsForDay = async () => {
        setPlayback(false);
        try {
            const allTripsData = [];
            const newAddresses = {};

            for (const trip of trips) {
                const { data } = await api.get(`/api/trips/${trip.id}?simplify=true`);
                allTripsData.push({ ...trip, ...data });

                if (data.points && data.points.length > 0) {
                    const startPoint = data.points[0];
                    newAddresses[`start-${trip.id}`] = await getAddress(startPoint.lat, startPoint.lng);
                    const endPoint = data.points.at(-1);
                    newAddresses[`end-${trip.id}`] = await getAddress(endPoint.lat, endPoint.lng);

                    for (let i = 0; i < (data.stops || []).length; i++) {
                        const stop = data.stops[i];
                        newAddresses[`stop-${trip.id}-${i}`] = await getAddress(stop.lat, stop.lng);
                    }
                }
            }

            setRouteData({ isMulti: true, trips: allTripsData });
            setTrip({ id: 'all_day', distance_meters: trips.reduce((acc, t) => acc + (t.distance_meters || 0), 0) });
            setAddresses(prev => ({ ...prev, ...newAddresses }));
        } catch (e) {
            console.error(e);
        }
    };

    const fetchTripDetails = async (trip) => {
        setPlayback(false);
        try {
            // ✅ OPTIMIZADO: Usar ?simplify=true para obtener ruta compilada
            // Reduce de 238 KB → 28 KB (88% reducción)
            // Puntos: 1920 → 120 (94% reducción)
            const { data } = await api.get(`/api/trips/${trip.id}?simplify=true`);
            setRouteData({ isMulti: false, ...data });
            setTrip(trip);

            // Cargar direcciones para inicio, fin y paradas
            const newAddresses = {};
            if (data.points.length > 0) {
                const startPoint = data.points[0];
                newAddresses[`start-${trip.id}`] = await getAddress(startPoint.lat, startPoint.lng);

                const endPoint = data.points.at(-1);
                newAddresses[`end-${trip.id}`] = await getAddress(endPoint.lat, endPoint.lng);

                for (let i = 0; i < data.stops.length; i++) {
                    const stop = data.stops[i];
                    newAddresses[`stop-${trip.id}-${i}`] = await getAddress(stop.lat, stop.lng);
                }
            }
            setAddresses(newAddresses);
        } catch (e) { console.error(e); }
    };

    const livePositions = Array.isArray(activeLocations) ? activeLocations : Object.values(activeLocations || {});

    // Determinar si hay puntos y stops
    const points = routeData && Array.isArray(routeData.points) ? routeData.points : [];
    const stops = routeData && Array.isArray(routeData.stops) ? routeData.stops : [];

    // Si no hay puntos, mostrar mensaje amigable
    const noPoints = view === 'history' && routeData && points.length === 0;

    return (
        <div style={{ height: '100%', width: '100%', position: 'relative' }}>
            {/* ── HISTORY CONTROLS (Side Panel) ── */}
            {view === 'history' && selectedEmployee && (
                <div className="history-sidepanel">
                    <h3 className="hs-title">Historial de Ruta</h3>
                    <div className="hs-employee">👤 {selectedEmployee.name}</div>

                    <input
                        type="date" value={date}
                        className="hs-date-picker"
                        onChange={e => { setDate(e.target.value); }}
                    />

                    {!routeData ? (
                        <div className="trip-list-overlay">
                            {trips.length === 0 && <div className="no-trips">Sin viajes registrados para este día.</div>}
                            {trips.length > 1 && (
                                <button className="map-action-btn" onClick={fetchAllTripsForDay} style={{ marginBottom: '10px' }}>
                                    🗺️ Ver Día Completo ({trips.length} viajes)
                                </button>
                            )}
                            {trips.map(t => (
                                <div key={t.id} className="trip-pill" onClick={() => fetchTripDetails(t)}>
                                    <span className="trip-time">⌚ Inicio: {dayjs(t.start_time).format('hh:mm A')}</span>
                                    <span className="trip-dist">🛣️ {(t.distance_meters / 1000).toFixed(2)} km</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="trip-details">
                            <button className="back-btn" onClick={() => { setRouteData(null); setPlayback(false); }}>
                                ← Volver a la lista
                            </button>

                            <div className="trip-stats-row">
                                <div className="stat-box">
                                    <span>Recorrido Total</span>
                                    <strong>{(selectedTrip.distance_meters / 1000).toFixed(2)} km</strong>
                                </div>
                                <div className="stat-box">
                                    <span>Paradas Totales</span>
                                    <strong>{routeData.isMulti ? routeData.trips.reduce((acc, t) => acc + (t.stops?.length || 0), 0) : (routeData.stops?.length || 0)}</strong>
                                </div>
                            </div>

                            {!routeData.isMulti && (
                                <button
                                    className={`map-action-btn ${playbackMode ? 'active' : ''}`}
                                    onClick={() => setPlayback(!playbackMode)}
                                    style={{ width: '100%', marginBottom: '20px', padding: '10px' }}
                                >
                                    {playbackMode ? '⏹ Detener Animación' : '▶ Reproducir Ruta (Playback)'}
                                </button>
                            )}

                            <h4 className="timeline-title">{routeData.isMulti ? 'Resumen del Día' : 'Línea de tiempo'}</h4>
                            <div className="timeline">
                                {routeData.isMulti ? (
                                    routeData.trips.map((tInfo, idx) => (
                                        <div key={`multi-${idx}`} style={{ marginBottom: '16px' }}>
                                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#6C63FF', marginBottom: '8px' }}>Viaje {idx + 1}</div>

                                            {/* Start Point */}
                                            <div className="timeline-item">
                                                <div className="tl-icon start-icon" style={{ width: '24px', height: '24px', fontSize: '12px' }}>🚀</div>
                                                <div className="tl-content">
                                                    <strong>Inicio</strong>
                                                    <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>📍 {addresses[`start-${tInfo.id}`] || 'Cargando...'}</span>
                                                    <span>{dayjs(tInfo.start_time).format('hh:mm A')}</span>
                                                </div>
                                            </div>

                                            {/* End Point */}
                                            {tInfo.points && tInfo.points.length > 0 && (
                                                <div className="timeline-item pb-0">
                                                    <div className="tl-icon end-icon" style={{ width: '24px', height: '24px', fontSize: '12px' }}>🏁</div>
                                                    <div className="tl-content">
                                                        <strong>Fin</strong>
                                                        <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>📍 {addresses[`end-${tInfo.id}`] || 'Cargando...'}</span>
                                                        <span>
                                                            {tInfo.points.at(-1)?.timestamp
                                                                ? dayjs(Number(tInfo.points.at(-1).timestamp)).format('hh:mm A')
                                                                : dayjs(tInfo.end_time || new Date()).format('hh:mm A')}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <>
                                        {/* Start Point */}
                                        <div className="timeline-item">
                                            <div className="tl-icon start-icon">🚀</div>
                                            <div className="tl-content">
                                                <strong>Inicio de jornada</strong>
                                                <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>📍 {addresses[`start-${selectedTrip?.id}`] || 'Cargando dirección...'}</span>
                                                <span>{dayjs(selectedTrip.start_time).format('hh:mm A')}</span>
                                            </div>
                                        </div>

                                        {/* Stops */}
                                        {(routeData.stops || []).map((s, i) => (
                                            <div key={i} className="timeline-item check">
                                                <div className="tl-line"></div>
                                                <div className="tl-icon stop-icon">🛑</div>
                                                <div className="tl-content">
                                                    <strong>Parada {i + 1}</strong>
                                                    <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>📍 {addresses[`stop-${selectedTrip?.id}-${i}`] || 'Cargando...'}</span>
                                                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                                                        ⏱ {Math.floor(s.duration_seconds / 60)} min {s.duration_seconds % 60} seg
                                                    </span>
                                                    <span className="tl-time text-muted">{dayjs(s.start_time).format('hh:mm A')} – {dayjs(s.end_time).format('hh:mm A')}</span>
                                                </div>
                                            </div>
                                        ))}

                                        {/* End Point */}
                                        {routeData.points && routeData.points.length > 0 && (
                                            <div className="timeline-item">
                                                <div className="tl-line"></div>
                                                <div className="tl-icon end-icon">🏁</div>
                                                <div className="tl-content">
                                                    <strong>Fin de jornada</strong>
                                                    <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>📍 {addresses[`end-${selectedTrip?.id}`] || 'Cargando dirección...'}</span>
                                                    <span>
                                                        {routeData.points.at(-1)?.timestamp
                                                            ? dayjs(Number(routeData.points.at(-1).timestamp)).format('hh:mm A')
                                                            : dayjs(selectedTrip.end_time || new Date()).format('hh:mm A')}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── LEGEND: live mode ── */}
            {view === 'live' && (
                <div className="map-legend">
                    <div className="legend-items">
                        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', color: '#0f172a' }}>Estado en Vivo</div>
                        <div className="legend-item"><div className="legend-dot" style={{ background: '#6366f1' }} /> En auto</div>
                        <div className="legend-item"><div className="legend-dot" style={{ background: '#22c55e' }} /> A pie</div>
                        <div className="legend-item"><div className="legend-dot" style={{ background: '#f59e0b' }} /> Lento</div>
                        <div className="legend-item"><div className="legend-dot" style={{ background: '#94a3b8' }} /> Quieto</div>
                        <div className="legend-divider" />
                        <div className="legend-item" style={{ fontWeight: 700, color: '#2563eb' }}>🔴 Activos: {livePositions.length}</div>
                    </div>
                </div>
            )}

            <MapContainer center={points[0] ? [points[0].lat, points[0].lng] : [-12.0464, -77.0428]} zoom={17} minZoom={10} maxZoom={19} zoomControl={false} style={{ height: '100%', width: '100%', backgroundColor: '#1A1A2E' }}>
                {/* Carto Dark - Oscuro y detallado (zoom 10-18) */}
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution="&copy; <a href='https://carto.com/'>carto.com</a>"
                    subdomains={['a', 'b', 'c', 'd']}
                    maxNativeZoom={18}
                    minZoom={10}
                    maxZoom={19}
                />
                {/* OpenStreetMap - Máxima precisión (zoom 19) */}
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; <a href='https://osm.org/'>OpenStreetMap</a>"
                    minZoom={19}
                    maxZoom={19}
                />

                {/* ── LIVE MODE ── */}
                {view === 'live' && livePositions.map(loc => {
                    const addr = addresses[`live-${loc.employeeId}`] || 'Obteniendo dirección...';
                    const displayState = (loc.state || 'Quieto').replaceAll('_', ' ');
                    const stateColors = {
                        'Quieto': { bg: '#f1f5f9', color: '#475569' },
                        'SIN_MOVIMIENTO': { bg: '#f1f5f9', color: '#475569' },
                        'A pie': { bg: '#dcfce7', color: '#166534' },
                        'CAMINANDO': { bg: '#dcfce7', color: '#166534' },
                        'Lento': { bg: '#fef3c7', color: '#b45309' },
                        'MOVIMIENTO_LENTO': { bg: '#fef3c7', color: '#b45309' },
                        'En auto': { bg: '#dbeafe', color: '#0c4a6e' },
                        'VEHICULO': { bg: '#dbeafe', color: '#0c4a6e' }
                    };
                    const stateColor = stateColors[loc.state] || stateColors['Quieto'];

                    return (
                        <Marker key={loc.employeeId} position={[loc.lat, loc.lng]} icon={getActiveIcon(loc.state)}>
                            <Popup>
                                <div style={{ fontSize: '13px', minWidth: '240px', padding: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '8px' }}>
                                        <div style={{ flex: 1 }}>
                                            <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block' }}>{loc.name || `Vendedor ${loc.employeeId}`}</strong>
                                            <span style={{ fontSize: '11px', color: '#475569' }}>ID: {loc.employeeId}</span>
                                        </div>
                                        <span style={{
                                            background: stateColor.bg,
                                            color: stateColor.color,
                                            padding: '3px 8px',
                                            borderRadius: '12px',
                                            fontSize: '11px',
                                            fontWeight: 'bold',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {displayState}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#64748b', borderTop: '1px solid #e2e8f0', paddingTop: '8px', marginBottom: '8px' }}>
                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                                            <span style={{ marginTop: '2px', fontSize: '12px' }}>📍</span>
                                            <span style={{ fontSize: '12px' }}>{addr}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                                            <span title="Última actualización">🕒 {dayjs(loc.lastUpdate).format('HH:mm:ss')}</span>
                                            <span title="Velocidad">📈 {loc.speed ? (loc.speed.toFixed(1) + ' km/h') : '0 km/h'}</span>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <a
                                            href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 'bold', fontSize: '12px', flex: 1, textAlign: 'center', padding: '6px', background: '#dbeafe', borderRadius: '6px', transition: 'all .2s' }}
                                            onMouseEnter={(e) => e.target.style.background = '#bfdbfe'}
                                            onMouseLeave={(e) => e.target.style.background = '#dbeafe'}
                                        >
                                            🗺️ Google Maps
                                        </a>
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* ── HISTORY MODE ── */}
                {view === 'history' && routeData && !playbackMode && (
                    <>
                        {/* Caso: Sin puntos */}
                        {noPoints && (
                            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', zIndex: 1000 }}>
                                <strong>Sin datos de recorrido para este viaje</strong>
                            </div>
                        )}
                        {/* Caso: Múltiples viajes (día completo) */}
                        {routeData.isMulti ? (
                            <>
                                <FitBounds positions={Array.isArray(routeData.trips) ? routeData.trips.flatMap(t => t.points || []) : []} />
                                {(Array.isArray(routeData.trips) ? routeData.trips : []).map((tInfo, idx) => {
                                    const pts = Array.isArray(tInfo.points) ? tInfo.points : [];
                                    const stopsArr = Array.isArray(tInfo.stops) ? tInfo.stops : [];
                                    // Mostrar marcador de inicio aunque solo haya 1 punto
                                    return (
                                        <React.Fragment key={`multi-trip-${idx}`}>
                                            {pts.length > 1 && <Polyline positions={pts.map(p => [p.lat, p.lng])} color="#6C63FF" weight={12} opacity={0.25} />}
                                            {pts.length > 1 && <Polyline positions={pts.map(p => [p.lat, p.lng])} color="#6C63FF" weight={4} opacity={1} />}
                                            {pts[0] && (
                                                <Marker position={[pts[0].lat, pts[0].lng]}>
                                                    <Popup>
                                                        <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                                            <strong>🚀 Inicio Trayecto {idx + 1}</strong><br />
                                                            🕐 {dayjs(tInfo.start_time).format('HH:mm:ss')}
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            )}
                                            {/* Fin solo si hay más de 1 punto */}
                                            {pts.length > 1 && (
                                                <Marker position={[pts.at(-1).lat, pts.at(-1).lng]}>
                                                    <Popup>
                                                        <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                                            <strong>🏁 Fin Trayecto {idx + 1}</strong><br />
                                                            🛣️ {((tInfo.distance_meters || 0) / 1000).toFixed(2)} km
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            )}
                                            {stopsArr.map((s, i) => (
                                                <Marker key={`multi-stop-${idx}-${i}`} position={[s.lat, s.lng]} icon={stopIcon}>
                                                    <Popup>
                                                        <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                                            <strong>🛑 Parada {i + 1} (Trayecto {idx + 1})</strong><br />
                                                            ⏱ {Math.floor(s.duration_seconds / 60)} min {s.duration_seconds % 60} seg
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            ))}
                                        </React.Fragment>
                                    );
                                })}
                            </>
                        ) : (
                            <>
                                <FitBounds positions={points} />
                                {/* Dibujar línea solo si hay más de 1 punto */}
                                {points.length > 1 && (
                                    <>
                                        <Polyline positions={points.map(p => [p.lat, p.lng])} color="#6C63FF" weight={12} opacity={0.25} />
                                        <Polyline positions={points.map(p => [p.lat, p.lng])} color="#6C63FF" weight={4} opacity={1} />
                                    </>
                                )}
                                {/* Siempre mostrar marcador de inicio */}
                                {points[0] && (
                                    <Marker position={[points[0].lat, points[0].lng]}>
                                        <Popup>
                                            <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                                <strong>🚀 Inicio del viaje</strong><br />
                                                📍 {addresses[`start-${selectedTrip.id}`] || 'Cargando...'}<br />
                                                🕐 {dayjs(selectedTrip.start_time).format('HH:mm:ss')}<br />
                                                <a
                                                    href={`https://www.google.com/maps?q=${points[0].lat},${points[0].lng}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 'bold', display: 'inline-block', marginTop: '6px' }}
                                                >
                                                    🗺️ Ver en Google Maps
                                                </a>
                                            </div>
                                        </Popup>
                                    </Marker>
                                )}
                                {/* Fin solo si hay más de 1 punto */}
                                {points.length > 1 && (
                                    <Marker position={[points.at(-1).lat, points.at(-1).lng]}>
                                        <Popup>
                                            <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                                <strong>🏁 Fin del viaje</strong><br />
                                                📍 {addresses[`end-${selectedTrip.id}`] || 'Cargando...'}<br />
                                                🛣️ {(selectedTrip?.distance_meters / 1000 || 0).toFixed(2)} km<br />
                                                <a
                                                    href={`https://www.google.com/maps?q=${points.at(-1).lat},${points.at(-1).lng}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 'bold', display: 'inline-block', marginTop: '6px' }}
                                                >
                                                    🗺️ Ver en Google Maps
                                                </a>
                                            </div>
                                        </Popup>
                                    </Marker>
                                )}
                                {/* Paradas */}
                                {stops.map((s, i) => (
                                    <Marker key={i} position={[s.lat, s.lng]} icon={stopIcon}>
                                        <Popup>
                                            <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                                <strong>🛑 Parada {i + 1}</strong><br />
                                                📍 {addresses[`stop-${selectedTrip.id}-${i}`] || 'Cargando...'}<br />
                                                ⏱ {Math.floor(s.duration_seconds / 60)} min {s.duration_seconds % 60} seg<br />
                                                🕐 {dayjs(s.start_time).format('HH:mm')} – {dayjs(s.end_time).format('HH:mm')}<br />
                                                <a
                                                    href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 'bold', display: 'inline-block', marginTop: '6px' }}
                                                >
                                                    🗺️ Ver en Google Maps
                                                </a>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}
                            </>
                        )}
                    </>
                )}

                {/* ── PLAYBACK MODE ── */}
                {view === 'history' && routeData && (routeData.points || []).length > 0 && playbackMode && (
                    <Playback points={routeData.points} />
                )}

                {/* Controles de zoom personalizado */}
                <ZoomControls />
            </MapContainer>

            <style>{`
        @keyframes pulse { 0% { transform:scale(1); opacity:.6 } 100% { transform:scale(2.5); opacity:0 } }

        .history-sidepanel {
          position: absolute; top: 12px; left: 56px; z-index: 1000;
          background: #ffffff; padding: 20px; border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,.15); width: 340px;
          display: flex; flex-direction: column; max-height: 85vh;
        }
        .hs-title { margin: 0; font-size: 18px; font-weight: 700; color: #0f172a; }
        .hs-employee { font-size: 13px; color: #64748b; margin-top: 6px; margin-bottom: 16px; font-weight: 500; }
        .hs-date-picker { margin-bottom: 16px; width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 14px; background: #f8fafc; outline: none; cursor: pointer; }
        .hs-date-picker:focus { border-color: #6C63FF; background: white; }
        
        .trip-list-overlay { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1; }
        .no-trips { font-size: 13px; color: #94a3b8; padding: 20px 0; text-align: center; }
        .trip-pill {
          display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: 10px; cursor: pointer;
          background: #f8fafc; font-size: 13px; border: 1px solid #e2e8f0; transition: all .2s ease;
        }
        .trip-pill:hover { border-color: #6C63FF; background: #f1f5f9; box-shadow: 0 2px 8px rgba(108, 99, 255, 0.1); }
        .trip-time { font-weight: 600; color: #0f172a; }
        .trip-dist { font-size: 12px; color: #64748b; }

        .trip-details { display: flex; flex-direction: column; overflow-y: auto; padding-right: 4px; flex: 1; }
        .back-btn { background: none; border: none; padding: 0 0 12px 0; color: #6C63FF; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left; margin-bottom: 8px; transition: color .2s; }
        .back-btn:hover { color: #5651d9; }
        
        .trip-stats-row { display: flex; gap: 10px; margin-bottom: 16px; }
        .stat-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 10px; display: flex; flex-direction: column; align-items: center; transition: all .2s; }
        .stat-box:hover { border-color: #cbd5e1; }
        .stat-box span { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
        .stat-box strong { font-size: 18px; color: #0f172a; }

        .map-action-btn {
          flex: 1; padding: 12px; background: #f1f5f9; border: none; border-radius: 10px;
          cursor: pointer; font-size: 14px; font-weight: 600; color: #0f172a; transition: all 0.2s;
        }
        .map-action-btn:hover { background: #e2e8f0; }
        .map-action-btn.active { background: #6C63FF; color: white; box-shadow: 0 4px 12px rgba(108,99,255,0.3); }

        .timeline-title { font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; margin-bottom: 12px; margin-top: 8px; font-weight: 600; }
        .timeline { display: flex; flex-direction: column; gap: 0; position: relative; margin-left: 10px; }
        .timeline-item { display: flex; gap: 16px; position: relative; padding-bottom: 20px; }
        .timeline-item:last-child { padding-bottom: 0; }
        
        .tl-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; z-index: 2; position: relative; flex-shrink: 0; }
        .start-icon { background: #e0e7ff; color: #4f46e5; border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,.1); }
        .stop-icon { background: #fef3c7; color: #d97706; border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,.1); }
        .end-icon { background: #e0e7ff; color: #4f46e5; border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,.1); }
        
        .tl-line { position: absolute; left: 15px; top: 32px; bottom: 0; width: 2px; background: #e2e8f0; z-index: 1; }
        .timeline-item:last-child .tl-line { display: none; }
        
        .tl-content { display: flex; flex-direction: column; gap: 3px; padding-top: 2px; }
        .tl-content strong { font-size: 14px; color: #0f172a; }
        .tl-content span { font-size: 12px; color: #64748b; }
        .text-muted { font-size: 11px !important; opacity: 0.8; }

        .map-legend {
          position: absolute; top: 12px; right: 12px; z-index: 1000;
          background: white; padding: 14px 16px; border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,.15); font-size: 13px; color: #0f172a;
        }
        .legend-items { display: flex; flex-direction: column; gap: 8px; }
        .legend-item { display: flex; align-items: center; gap: 10px; font-weight: 500; }
        .legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
        .legend-divider { height: 1px; background: #e2e8f0; margin: 2px 0; }

        /* Zoom Controls */
        .zoom-controls { position: fixed !important; }
        .zoom-btn {
          width: 44px; height: 44px; border: none; border-radius: 8px;
          background: white; color: #0f172a; font-size: 20px; font-weight: bold;
          cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2);
          transition: all 0.2s; display: flex; align-items: center; justify-content: center;
        }
        .zoom-btn:hover { background: #f1f5f9; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
        .zoom-btn:active { transform: scale(0.95); }

        /* Responsive Design */
        @media (max-width: 768px) {
          .history-sidepanel { width: calc(100vw - 32px); max-width: 340px; left: 16px; top: 16px; }
          .map-legend { top: auto; bottom: 80px; }
          .zoom-btn { width: 40px; height: 40px; font-size: 18px; }
        }

        @media (max-width: 480px) {
          .history-sidepanel { width: calc(100vw - 24px); padding: 16px; left: 12px; top: 12px; max-height: 70vh; }
          .hs-title { font-size: 16px; }
          .trip-pill { padding: 10px; }
          .map-legend { bottom: 75px; padding: 10px 12px; font-size: 12px; }
          .zoom-btn { width: 38px; height: 38px; font-size: 16px; }
        }
        .zoom-btn:hover { background: #f1f5f9; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
        .zoom-btn:active { transform: scale(0.95); }

        @media (max-width: 768px) {
          .zoom-btn { width: 40px; height: 40px; font-size: 18px; }
        }

        @media (max-width: 480px) {
          .zoom-btn { width: 36px; height: 36px; font-size: 16px; }
        }

        /* Mobile Responsive */
        @media (max-width: 1024px) {
          .history-sidepanel { 
            width: 280px; 
            left: 12px;
          }
        }

        @media (max-width: 768px) {
          .history-sidepanel { 
            position: fixed; 
            top: 50px; 
            left: 0; 
            right: 0; 
            width: 100%; 
            max-height: calc(100vh - 50px);
            border-radius: 0;
            z-index: 950;
            max-width: 100%;
            padding: 16px;
          }
          .hs-title { font-size: 14px; }
          .hs-employee { font-size: 13px; }
          .trip-pill { font-size: 12px; padding: 10px; }
          .trip-time { font-size: 12px; }
          .trip-dist { font-size: 11px; }
          .back-btn { font-size: 12px; margin-bottom: 12px; }
          .timeline-title { font-size: 12px; }
          .tl-content strong { font-size: 13px; }
          .tl-content span { font-size: 11px; }
          .stat-box { padding: 10px; }
          .stat-box strong { font-size: 14px; }
          .stat-box span { font-size: 10px; }
        }

        @media (max-width: 480px) {
          .history-sidepanel { 
            padding: 12px; 
            top: 44px;
            max-height: calc(100vh - 44px);
          }
          .hs-title { font-size: 13px; }
          .hs-employee { font-size: 12px; margin-bottom: 12px; }
          .hs-date-picker { font-size: 13px; padding: 8px 10px; margin-bottom: 12px; }
          .trip-pill { padding: 8px; gap: 2px; }
          .trip-time { font-size: 11px; }
          .trip-dist { font-size: 10px; }
          .trip-stats-row { gap: 8px; margin-bottom: 12px; }
          .stat-box { padding: 8px; border-radius: 8px; }
          .stat-box strong { font-size: 13px; }
          .map-action-btn { padding: 10px; font-size: 12px; border-radius: 8px; }
          .timeline { margin-left: 8px; }
          .timeline-item { gap: 12px; padding-bottom: 20px; }
          .tl-icon { width: 24px; height: 24px; font-size: 11px; }
          .tl-line { left: 11px; }
          .tl-content strong { font-size: 12px; }
          .tl-content span { font-size: 10px; }
          .timeline-title { font-size: 11px; margin-bottom: 10px; }
          .map-legend { top: 60px; right: 8px; padding: 6px 10px; font-size: 12px; }
        }
      `}</style>
        </div>
    );
};

export default MapView;
