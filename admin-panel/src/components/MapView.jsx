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

// Active vendor icon
const activeIcon = L.divIcon({
    className: '',
    html: `<div style="position:relative">
    <div style="background:#2563eb;border:3px solid white;border-radius:50%;width:18px;height:18px;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>
    <div style="position:absolute;top:-2px;left:-2px;width:22px;height:22px;border:2px solid #2563eb;border-radius:50%;animation:pulse 1.5s infinite;opacity:.5"></div>
  </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
});

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

// Reverse geocoding - obtener dirección desde coordenadas
const getAddress = async (lat, lng) => {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await response.json();
        return data.address?.road || data.address?.street || data.display_name?.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (e) {
        console.error('Geocoding error:', e);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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

    const fetchTripDetails = async (trip) => {
        setPlayback(false);
        try {
            const { data } = await api.get(`/api/trips/${trip.id}`);
            setRouteData(data);
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

    const livePositions = Object.values(activeLocations);

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
                                    <span>Recorrido</span>
                                    <strong>{(selectedTrip.distance_meters / 1000).toFixed(2)} km</strong>
                                </div>
                                <div className="stat-box">
                                    <span>Paradas</span>
                                    <strong>{routeData.stops.length}</strong>
                                </div>
                            </div>

                            <button
                                className={`map-action-btn ${playbackMode ? 'active' : ''}`}
                                onClick={() => setPlayback(!playbackMode)}
                                style={{ width: '100%', marginBottom: '20px', padding: '10px' }}
                            >
                                {playbackMode ? '⏹ Detener Animación' : '▶ Reproducir Ruta (Playback)'}
                            </button>

                            <h4 className="timeline-title">Línea de tiempo</h4>
                            <div className="timeline">
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
                                {routeData.stops.map((s, i) => (
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
                                {routeData.points.length > 0 && (
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
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── LEGEND: live mode ── */}
            {view === 'live' && (
                <div className="map-legend">
                    <div className="legend-dot active-dot" /> Activo ({livePositions.length})
                </div>
            )}

            <MapContainer center={[-12.0464, -77.0428]} zoom={17} minZoom={10} maxZoom={19} zoomControl={false} style={{ height: '100%', width: '100%', backgroundColor: '#1A1A2E' }}>
                {/* Carto Dark - Oscuro y detallado (zoom 10-18) */}
                <TileLayer 
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" 
                    attribution="&copy; <a href='https://carto.com/'>carto.com</a>" 
                    subdomains={['a', 'b', 'c', 'd']}
                    maxNativeZoom={18}
                    minZoom={10}
                    maxZoom={18}
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
                    return (
                        <Marker key={loc.employeeId} position={[loc.lat, loc.lng]} icon={activeIcon}>
                            <Popup>
                                <div style={{ fontSize: '12px', minWidth: '200px' }}>
                                    <strong>{loc.name || `Vendedor ${loc.employeeId}`}</strong><br />
                                    📍 <span style={{ fontSize: '11px', color: '#666' }}>{addr}</span><br />
                                    🕒 {dayjs(loc.lastUpdate).format('HH:mm:ss')}<br />
                                    📈 {loc.speed ? (loc.speed.toFixed(1) + ' km/h') : 'Detenido'}
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* ── HISTORY MODE ── */}
                {view === 'history' && routeData && !playbackMode && (
                    <>
                        <FitBounds positions={routeData.points} />
                        {routeData.points.length > 1 && (
                            <>
                                <Polyline positions={routeData.points.map(p => [p.lat, p.lng])} color="#6C63FF" weight={12} opacity={0.25} />
                                <Polyline positions={routeData.points.map(p => [p.lat, p.lng])} color="#6C63FF" weight={4} opacity={1} />
                            </>
                        )}
                        {/* Start marker */}
                        {routeData.points[0] && (
                            <Marker position={[routeData.points[0].lat, routeData.points[0].lng]}>
                                <Popup>
                                    <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                        <strong>🚀 Inicio del viaje</strong><br />
                                        📍 {addresses[`start-${selectedTrip.id}`] || 'Cargando...'}<br />
                                        🕐 {dayjs(selectedTrip.start_time).format('HH:mm:ss')}
                                    </div>
                                </Popup>
                            </Marker>
                        )}
                        {/* End marker */}
                        {routeData.points.length > 1 && (
                            <Marker position={[routeData.points.at(-1).lat, routeData.points.at(-1).lng]}>
                                <Popup>
                                    <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                        <strong>🏁 Fin del viaje</strong><br />
                                        📍 {addresses[`end-${selectedTrip.id}`] || 'Cargando...'}<br />
                                        🛣️ {(selectedTrip?.distance_meters / 1000 || 0).toFixed(2)} km
                                    </div>
                                </Popup>
                            </Marker>
                        )}
                        {/* Stops */}
                        {routeData.stops.map((s, i) => (
                            <Marker key={i} position={[s.lat, s.lng]} icon={stopIcon}>
                                <Popup>
                                    <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                        <strong>🛑 Parada {i + 1}</strong><br />
                                        📍 {addresses[`stop-${selectedTrip.id}-${i}`] || 'Cargando...'}<br />
                                        ⏱ {Math.floor(s.duration_seconds / 60)} min {s.duration_seconds % 60} seg<br />
                                        🕐 {dayjs(s.start_time).format('HH:mm')} – {dayjs(s.end_time).format('HH:mm')}
                                    </div>
                                </Popup>
                            </Marker>
                        ))}
                    </>
                )}

                {/* ── PLAYBACK MODE ── */}
                {view === 'history' && routeData && playbackMode && (
                    <Playback points={routeData.points} />
                )}

                {/* Controles de zoom personalizado */}
                <ZoomControls />
            </MapContainer>

            <style>{`
        @keyframes pulse { 0% { transform:scale(1); opacity:.6 } 100% { transform:scale(2.5); opacity:0 } }

        .history-sidepanel {
          position: absolute; top: 12px; left: 56px; z-index: 1000;
          background: #ffffff; padding: 20px; border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,.15); width: 320px;
          display: flex; flex-direction: column; max-height: 90vh;
        }
        .hs-title { margin: 0; font-size: 16px; font-weight: 700; color: #1e293b; }
        .hs-employee { font-size: 14px; color: #64748b; margin-top: 4px; margin-bottom: 16px; font-weight: 500; }
        .hs-date-picker { margin-bottom: 16px; width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #cbd5e1; font-size: 14px; background: #f8fafc; outline: none; }
        .hs-date-picker:focus { border-color: #6C63FF; }
        
        .trip-list-overlay { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
        .no-trips { font-size: 13px; color: #94a3b8; padding: 8px 0; text-align: center; }
        .trip-pill {
          display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: 10px; cursor: pointer;
          background: #f8fafc; font-size: 13px; border: 1px solid #e2e8f0; transition: all .2s ease;
        }
        .trip-pill:hover  { border-color: #6C63FF; background: #f1f5f9; }
        .trip-time { font-weight: 600; color: #1e293b; }
        .trip-dist { font-size: 12px; color: #64748b; }

        .trip-details { display: flex; flex-direction: column; overflow-y: auto; padding-right: 4px; }
        .back-btn { background: none; border: none; padding: 0; color: #6C63FF; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; margin-bottom: 16px; }
        
        .trip-stats-row { display: flex; gap: 10px; margin-bottom: 16px; }
        .stat-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 10px; display: flex; flex-direction: column; align-items: center; }
        .stat-box span { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .stat-box strong { font-size: 16px; color: #1e293b; }

        .map-action-btn {
          flex: 1; padding: 12px; background: #f1f5f9; border: none; border-radius: 10px;
          cursor: pointer; font-size: 13px; font-weight: 600; color: #1e293b; transition: all 0.2s;
        }
        .map-action-btn.active { background: #6C63FF; color: white; box-shadow: 0 4px 12px rgba(108,99,255,0.3); }

        .timeline-title { font-size: 13px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; margin-bottom: 12px; margin-top: 8px; }
        .timeline { display: flex; flex-direction: column; gap: 0; position: relative; margin-left: 10px; }
        .timeline-item { display: flex; gap: 16px; position: relative; padding-bottom: 24px; }
        .timeline-item:last-child { padding-bottom: 0; }
        
        .tl-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; z-index: 2; position: relative; }
        .start-icon { background: #e0e7ff; color: #4f46e5; border: 2px solid #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
        .stop-icon { background: #fef3c7; color: #d97706; border: 2px solid #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
        .end-icon { background: #e2e8f0; color: #475569; border: 2px solid #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
        
        .tl-line { position: absolute; left: 13px; top: 28px; bottom: 0; width: 2px; background: #e2e8f0; z-index: 1; }
        .timeline-item:last-child .tl-line { display: none; }
        
        .tl-content { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; }
        .tl-content strong { font-size: 14px; color: #1e293b; }
        .tl-content span { font-size: 12px; color: #64748b; }
        .text-muted { font-size: 11px !important; opacity: 0.8; }

        .map-legend {
          position: absolute; top: 12px; right: 12px; z-index: 1000;
          background: white; padding: 8px 14px; border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,.1); font-size: 13px; color: #1e293b;
          display: flex; align-items: center; gap: 8px;
        }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .active-dot { background: #2563eb; }

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
