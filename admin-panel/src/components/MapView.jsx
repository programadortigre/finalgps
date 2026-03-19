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
    let isPaused = state === 'PAUSED';
    
    if (state === 'Quieto' || state === 'SIN_MOVIMIENTO' || state === 'STOPPED' || state === 'DEEP_SLEEP') color = '#94a3b8';
    if (state === 'A pie' || state === 'CAMINANDO' || state === 'WALKING') color = '#22c55e';
    if (state === 'Lento' || state === 'MOVIMIENTO_LENTO' || state === 'BATT_SAVER' || state === 'NO_SIGNAL') color = '#f59e0b';
    if (state === 'En auto' || state === 'VEHICULO' || state === 'DRIVING') color = '#6366f1';
    if (isPaused) color = '#1e293b'; // Slate 800 for paused

    return L.divIcon({
        className: '',
        html: `<div style="position:relative">
        <div style="background:${color};border:3px solid white;border-radius:50%;width:18px;height:18px;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>
        ${!isPaused ? `<div style="position:absolute;top:-2px;left:-2px;width:22px;height:22px;border:2px solid ${color};border-radius:50%;animation:pulse 1.5s infinite;opacity:.5"></div>` : ''}
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

// Vuela suavemente a la ubicación de un empleado seleccionado
const FlyToEmployee = ({ lat, lng }) => {
    const map = useMap();
    const lastPos = React.useRef(null);

    useEffect(() => {
        if (lat != null && lng != null) {
            const currentCenter = map.getCenter();
            const dist = L.latLng(lat, lng).distanceTo(currentCenter);
            
            // Si está lejos (>200m) o es la primera vez, vuela (FlyTo)
            if (!lastPos.current || dist > 200) {
                map.flyTo([lat, lng], 18, { animate: true, duration: 1.2 });
            } else if (dist > 5) {
                // Si está cerca but moved, solo panea suavemente (para seguimiento en tiempo real)
                map.panTo([lat, lng], { animate: true });
            }
            lastPos.current = { lat, lng };
        }
    }, [lat, lng, map]);
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

const MapView = ({ view, selectedEmployee, activeLocations, allLocations, selectedTrip: propSelectedTrip, tripDetails: propTripDetails }) => {
    const [trips, setTrips] = useState([]);
    const [selectedTrip, setTrip] = useState(propSelectedTrip || null);
    const [routeData, setRouteData] = useState(propTripDetails ? { isMulti: false, ...propTripDetails } : null);
    const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [playbackMode, setPlayback] = useState(false);
    const [addresses, setAddresses] = useState({});

    // Cargar direcciones cuando se reciben tripDetails como prop
    useEffect(() => {
        if (propTripDetails && propSelectedTrip) {
            console.log('[MapView] Recibido tripDetails como prop:', {
                trip: propSelectedTrip,
                pointsCount: propTripDetails.points?.length,
                stopsCount: propTripDetails.stops?.length
            });
            setTrip(propSelectedTrip);
            setRouteData({ isMulti: false, ...propTripDetails });
            
            // Cargar direcciones
            const loadAddresses = async () => {
                const newAddresses = {};
                const data = propTripDetails;
                
                if (data.points && data.points.length > 0) {
                    const startPoint = data.points[0];
                    newAddresses[`start-${propSelectedTrip.id}`] = await getAddress(startPoint.lat, startPoint.lng);

                    const endPoint = data.points.at(-1);
                    newAddresses[`end-${propSelectedTrip.id}`] = await getAddress(endPoint.lat, endPoint.lng);

                    for (let i = 0; i < (data.stops || []).length; i++) {
                        const stop = data.stops[i];
                        newAddresses[`stop-${propSelectedTrip.id}-${i}`] = await getAddress(stop.lat, stop.lng);
                    }
                }
                setAddresses(newAddresses);
            };
            
            loadAddresses();
        }
    }, [propTripDetails, propSelectedTrip]);

    // Fetch trips when employee/date changes
    useEffect(() => {
        if (view === 'history' && selectedEmployee && !propTripDetails) {
            setRouteData(null); setTrip(null); setPlayback(false);
            api.get(`/api/trips?employeeId=${selectedEmployee.id}&date=${date}`)
                .then(r => setTrips(r.data))
                .catch(console.error);
        }
    }, [selectedEmployee, date, view, propTripDetails]);

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

    // Si no hay puntos, mostrar mensaje amigable (solo si no es multi-recorrido)
    const noPoints = view === 'history' && routeData && !routeData.isMulti && points.length === 0;

    const flyTarget = selectedEmployee && view === 'live'
        ? (activeLocations[selectedEmployee.id])
        : null;

    return (
        <div style={{ height: '100%', width: '100%', position: 'relative' }}>
            {/* ── HISTORY CONTROLS (Side Panel) ── */}
            {view === 'history' && selectedEmployee && !propTripDetails && (
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
                                        <div key={`multi-${idx}`} style={{ marginBottom: '24px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: '800', color: '#60a5fa', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Viaje {idx + 1}</div>

                                            {/* Start Point */}
                                            <div className="timeline-item">
                                                <div className="tl-icon start-icon">🚀</div>
                                                <div className="tl-content">
                                                    <strong>Inicio de viaje</strong>
                                                    <span>{addresses[`start-${tInfo.id}`] || 'Cargando...'}</span>
                                                    <span style={{ color: '#fff', fontWeight: '600' }}>{dayjs(tInfo.start_time).format('hh:mm A')}</span>
                                                    <a 
                                                        href={`https://www.google.com/maps?q=${tInfo.points?.[0]?.lat},${tInfo.points?.[0]?.lng}`}
                                                        target="_blank" rel="noopener noreferrer" className="gmaps-link"
                                                    >
                                                        🗺️ Google Maps
                                                    </a>
                                                </div>
                                            </div>

                                            {/* End Point */}
                                            {tInfo.points && tInfo.points.length > 0 && (
                                                <div className="timeline-item" style={{ paddingBottom: 0 }}>
                                                    <div className="tl-icon end-icon">🏁</div>
                                                    <div className="tl-content">
                                                        <strong>Fin de viaje</strong>
                                                        <span>{addresses[`end-${tInfo.id}`] || 'Cargando...'}</span>
                                                        <span style={{ color: '#fff', fontWeight: '600' }}>
                                                            {tInfo.points.at(-1)?.timestamp
                                                                ? dayjs(Number(tInfo.points.at(-1).timestamp)).format('hh:mm A')
                                                                : dayjs(tInfo.end_time || new Date()).format('hh:mm A')}
                                                        </span>
                                                        <a 
                                                            href={`https://www.google.com/maps?q=${tInfo.points.at(-1).lat},${tInfo.points.at(-1).lng}`}
                                                            target="_blank" rel="noopener noreferrer" className="gmaps-link"
                                                        >
                                                            🗺️ Google Maps
                                                        </a>
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
                                                <span>{addresses[`start-${selectedTrip?.id}`] || 'Cargando dirección...'}</span>
                                                <span style={{ color: '#fff', fontWeight: '600' }}>{dayjs(selectedTrip.start_time).format('hh:mm A')}</span>
                                                <a 
                                                    href={`https://www.google.com/maps?q=${points[0]?.lat},${points[0]?.lng}`}
                                                    target="_blank" rel="noopener noreferrer" className="gmaps-link"
                                                >
                                                    🗺️ Ver en Google Maps
                                                </a>
                                            </div>
                                        </div>

                                        {/* Stops */}
                                        {(routeData.stops || []).map((s, i) => (
                                            <div key={i} className="timeline-item">
                                                <div className="tl-line"></div>
                                                <div className="tl-icon stop-icon">🛑</div>
                                                <div className="tl-content">
                                                    <strong>Parada {i + 1}</strong>
                                                    <span>{addresses[`stop-${selectedTrip?.id}-${i}`] || 'Cargando...'}</span>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                                                        <span style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '700' }}>
                                                            ⏱ {Math.floor(s.duration_seconds / 60)}m {s.duration_seconds % 60}s
                                                        </span>
                                                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>{dayjs(s.start_time).format('hh:mm A')} – {dayjs(s.end_time).format('hh:mm A')}</span>
                                                    </div>
                                                    <a 
                                                        href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                                                        target="_blank" rel="noopener noreferrer" className="gmaps-link"
                                                    >
                                                        🗺️ Ver en Google Maps
                                                    </a>
                                                </div>
                                            </div>
                                        ))}

                                        {/* End Point */}
                                        <div className="timeline-item" style={{ paddingBottom: 0 }}>
                                            <div className="tl-icon end-icon">🏁</div>
                                            <div className="tl-content">
                                                <strong>Fin de jornada</strong>
                                                <span>{addresses[`end-${selectedTrip?.id}`] || 'Cargando dirección...'}</span>
                                                <span style={{ color: '#fff', fontWeight: '600' }}>
                                                    {points.at(-1)?.timestamp
                                                        ? dayjs(Number(points.at(-1).timestamp)).format('hh:mm A')
                                                        : dayjs(selectedTrip.end_time || new Date()).format('hh:mm A')}
                                                </span>
                                                <a 
                                                    href={`https://www.google.com/maps?q=${points.at(-1)?.lat},${points.at(-1)?.lng}`}
                                                    target="_blank" rel="noopener noreferrer" className="gmaps-link"
                                                >
                                                    🗺️ Ver en Google Maps
                                                </a>
                                            </div>
                                        </div>
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

                {/* ── FLY TO SELECTED EMPLOYEE ── */}
                {view === 'live' && flyTarget?.lat && (
                    <FlyToEmployee lat={flyTarget.lat} lng={flyTarget.lng} />
                )}

                {/* ── LIVE MODE ── */}
                {view === 'live' && livePositions.map(loc => {
                    if (!loc.lat || !loc.lng || loc.lat === 0 || loc.lng === 0) return null; // FIX: Prevent Leaflet crash
                    
                    const addr = addresses[`live-${loc.employeeId}`] || 'Obteniendo dirección...';
                    const displayState = (loc.state || 'Quieto').replaceAll('_', ' ');
                    const stateColors = {
                        'Quieto': { bg: '#f1f5f9', color: '#475569' },
                        'SIN_MOVIMIENTO': { bg: '#f1f5f9', color: '#475569' },
                        'STOPPED': { bg: '#f1f5f9', color: '#475569' },
                        'DEEP_SLEEP': { bg: '#e2e8f0', color: '#334155' },
                        'A pie': { bg: '#dcfce7', color: '#166534' },
                        'CAMINANDO': { bg: '#dcfce7', color: '#166534' },
                        'WALKING': { bg: '#dcfce7', color: '#166534' },
                        'Lento': { bg: '#fef3c7', color: '#b45309' },
                        'MOVIMIENTO_LENTO': { bg: '#fef3c7', color: '#b45309' },
                        'BATT_SAVER': { bg: '#fef3c7', color: '#b45309' },
                        'NO_SIGNAL': { bg: '#fee2e2', color: '#991b1b' },
                        'En auto': { bg: '#dbeafe', color: '#0c4a6e' },
                        'VEHICULO': { bg: '#dbeafe', color: '#0c4a6e' },
                        'DRIVING': { bg: '#dbeafe', color: '#0c4a6e' }
                    };
                    const stateColor = stateColors[loc.state] || stateColors['Quieto'];

                    return (
                        <Marker key={loc.employeeId} position={[loc.lat, loc.lng]} icon={getActiveIcon(loc.is_tracking_enabled === false ? 'PAUSED' : loc.state)}>
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
                                            <div className="modern-popup">
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '18px' }}>🛑</span>
                                                    <strong style={{ fontSize: '15px' }}>Parada {i + 1}</strong>
                                                </div>
                                                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px', lineHeight: '1.4' }}>
                                                    {addresses[`stop-${selectedTrip.id}-${i}`] || 'Obteniendo dirección...'}
                                                </div>
                                                <div style={{ 
                                                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', 
                                                    padding: '10px', background: 'rgba(255,255,255,0.05)', 
                                                    borderRadius: '10px', marginBottom: '12px' 
                                                }}>
                                                    <div>
                                                        <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>Duración</div>
                                                        <div style={{ fontSize: '12px', fontWeight: '600' }}>{Math.floor(s.duration_seconds / 60)}m {s.duration_seconds % 60}s</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>Horario</div>
                                                        <div style={{ fontSize: '12px', fontWeight: '600' }}>{dayjs(s.start_time).format('HH:mm')} - {dayjs(s.end_time).format('HH:mm')}</div>
                                                    </div>
                                                </div>
                                                <a
                                                    href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="gmaps-link"
                                                    style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                                                >
                                                    📍 Navegar con Google Maps
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
        @keyframes animate-pulse { 0% { transform:scale(1); opacity:.6 } 100% { transform:scale(2.5); opacity:0 } }

        .history-sidepanel {
          position: absolute; top: 20px; left: 20px; z-index: 1000;
          background: rgba(15, 23, 42, 0.8) !important;
          backdrop-filter: blur(16px) saturate(180%) !important;
          -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          padding: 24px; border-radius: 20px;
          box-shadow: 0 20px 50px rgba(0,0,0,.4); width: 360px;
          display: flex; flex-direction: column; max-height: calc(100vh - 40px);
          color: #f1f5f9;
        }
        .hs-title { margin: 0; font-size: 20px; font-weight: 700; color: #fff; font-family: 'Outfit', sans-serif; letter-spacing: -0.02em; }
        .hs-employee { font-size: 13px; color: #94a3b8; margin-top: 6px; margin-bottom: 20px; display: flex; alignItems: center; gap: 6px; }
        .hs-date-picker { 
            margin-bottom: 20px; width: 100%; padding: 12px; border-radius: 12px; 
            border: 1px solid rgba(255,255,255,0.1); font-size: 14px; 
            background: rgba(255,255,255,0.05); color: #fff; outline: none; transition: all 0.2s;
        }
        .hs-date-picker:focus { border-color: #3b82f6; background: rgba(255,255,255,0.1); }
        
        .trip-list-overlay { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; flex: 1; padding-right: 4px; }
        .no-trips { font-size: 14px; color: #64748b; padding: 40px 0; text-align: center; }
        .trip-pill {
          display: flex; flex-direction: column; gap: 6px; padding: 16px; border-radius: 14px; cursor: pointer;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); transition: all .25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .trip-pill:hover { background: rgba(255,255,255,0.08); border-color: #3b82f6; transform: translateY(-2px); }
        .trip-time { font-weight: 600; color: #f1f5f9; font-size: 14px; }
        .trip-dist { font-size: 12px; color: #94a3b8; }

        .trip-details { display: flex; flex-direction: column; overflow-y: auto; padding-right: 4px; flex: 1; }
        .back-btn { 
            background: none; border: none; padding: 0 0 16px 0; color: #60a5fa; 
            font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; 
            display: flex; align-items: center; gap: 6px;
        }
        .back-btn:hover { color: #93c5fd; }
        
        .trip-stats-row { display: flex; gap: 12px; margin-bottom: 20px; }
        .stat-box { 
            flex: 1; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); 
            padding: 16px; border-radius: 14px; display: flex; flex-direction: column; align-items: center;
        }
        .stat-box span { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
        .stat-box strong { font-size: 18px; color: #fff; font-family: 'Outfit'; }

        .map-action-btn {
          flex: 1; padding: 14px; background: #2563eb; border: none; border-radius: 12px;
          cursor: pointer; font-size: 14px; font-weight: 600; color: #fff; transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
        }
        .map-action-btn:hover { background: #1d4ed8; transform: translateY(-1px); }
        .map-action-btn.active { background: #ef4444; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3); }

        .timeline-title { font-size: 11px; text-transform: uppercase; color: #475569; letter-spacing: 1.5px; margin-bottom: 16px; font-weight: 800; }
        .timeline { display: flex; flex-direction: column; gap: 0; position: relative; margin-left: 10px; }
        .timeline-item { display: flex; gap: 20px; position: relative; padding-bottom: 24px; }
        .timeline-item:last-child { padding-bottom: 0; }
        
        .tl-icon { width: 36px; height: 36px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 16px; z-index: 2; position: relative; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1); }
        .start-icon { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
        .stop-icon { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
        .end-icon { background: rgba(37, 99, 235, 0.1); color: #3b82f6; }
        
        .tl-line { position: absolute; left: 18px; top: 36px; bottom: 0; width: 2px; background: rgba(255,255,255,0.05); z-index: 1; }
        .timeline-item:last-child .tl-line { display: none; }
        
        .tl-content { display: flex; flex-direction: column; gap: 4px; }
        .tl-content strong { font-size: 14px; color: #f1f5f9; }
        .tl-content span { font-size: 12px; color: #94a3b8; }
        .gmaps-link { 
            color: #60a5fa; text-decoration: none; font-size: 11px; font-weight: 700; 
            margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; 
            padding: 6px 10px; background: rgba(37, 99, 235, 0.1); border-radius: 6px;
            width: fit-content; transition: background 0.2s;
        }
        .gmaps-link:hover { background: rgba(37, 99, 235, 0.2); }

        .map-legend {
          position: absolute; bottom: 30px; left: 400px; z-index: 1000;
          background: rgba(15, 23, 42, 0.8) !important;
          backdrop-filter: blur(12px) !important;
          padding: 16px 20px; border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.1) !important;
          box-shadow: 0 10px 30px rgba(0,0,0,.3); color: #fff;
        }
        .legend-items { display: flex; align-items: center; gap: 20px; }
        .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: #94a3b8; }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .legend-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.1); }

        /* Zoom Controls */
        .zoom-controls { position: absolute; bottom: 30px; right: 30px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; }
        .zoom-btn {
          width: 50px; height: 50px; border: 1px solid rgba(255,255,255,0.1); border-radius: 15px;
          background: rgba(15, 23, 42, 0.8) !important;
          backdrop-filter: blur(12px) !important;
          color: white; font-size: 24px; font-weight: 400;
          cursor: pointer; box-shadow: 0 10px 25px rgba(0,0,0,.3);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex; align-items: center; justify-content: center; font-family: 'Outfit';
        }
        .zoom-btn:hover { background: #2563eb !important; transform: scale(1.05); }
        .zoom-btn:active { transform: scale(0.95); }

        /* Leaflet Popup Premium */
        .leaflet-popup-content-wrapper { 
            background: rgba(15, 23, 42, 0.9) !important; 
            backdrop-filter: blur(12px) !important;
            color: white !important;
            border-radius: 16px !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            box-shadow: 0 10px 30px rgba(0,0,0,.4) !important;
        }
        .leaflet-popup-content { margin: 16px !important; }
        .leaflet-popup-tip { background: rgba(15, 23, 42, 0.9) !important; }

        /* Responsive Design */
        @media (max-width: 768px) {
          .history-sidepanel { width: calc(100vw - 40px); left: 20px; top: 20px; }
          .map-legend { left: 20px; bottom: 100px; padding: 10px; }
          .legend-items { flex-wrap: wrap; gap: 10px; }
        }
tory-sidepanel { width: calc(100vw - 32px); max-width: 340px; left: 16px; top: 16px; }
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
