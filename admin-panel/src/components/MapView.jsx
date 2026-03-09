import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';
import socket from '../services/socket';
import Playback from './Playback';
import dayjs from 'dayjs';
import { simplifyPolyline, formatGoogleMapsUrl } from '../utils/simplifyPolyline';

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

// Reverse geocoding
const getAddress = async (lat, lng) => {
    try {
        const response = await api.get(`/api/geocoding/reverse?lat=${lat}&lng=${lng}`);
        return response.data.address;
    } catch (e) {
        console.error('Geocoding error:', e);
        return `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
    }
};

// 🔑 POLYLINE EN VIVO - Se dibuja mientras el vendedor se mueve
const LivePolyline = ({ activeLocations }) => {
    const livePathsRef = useRef({});

    useEffect(() => {
        socket.on('location_update', (data) => {
            const { employeeId, lat, lng } = data;
            
            if (!livePathsRef.current[employeeId]) {
                livePathsRef.current[employeeId] = [];
            }
            
            livePathsRef.current[employeeId].push([lat, lng]);
            
            // Mantener últimos 500 puntos (~2 horas)
            if (livePathsRef.current[employeeId].length > 500) {
                livePathsRef.current[employeeId].shift();
            }
        });

        return () => socket.off('location_update');
    }, []);

    return (
        <>
            {Object.entries(livePathsRef.current || {}).map(([empId, path]) => (
                path && path.length > 1 && (
                    <Polyline
                        key={`live-poly-${empId}`}
                        positions={path}
                        color="#2563eb"
                        weight={3}
                        opacity={0.6}
                        dashArray="5, 5"
                    />
                )
            ))}
        </>
    );
};

const MapView = ({ view, selectedEmployee, activeLocations }) => {
    const [trips, setTrips] = useState([]);
    const [selectedTrip, setTrip] = useState(null);
    const [routeData, setRouteData] = useState(null);
    const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [playbackMode, setPlayback] = useState(false);
    const [addresses, setAddresses] = useState({});
    const [loading, setLoading] = useState(false);

    // Fetch trips cuando cambia empleado/fecha
    useEffect(() => {
        if (view === 'history' && selectedEmployee) {
            setLoading(true);
            setRouteData(null);
            setTrip(null);
            setPlayback(false);
            api.get(`/api/trips?employeeId=${selectedEmployee.id}&date=${date}`)
                .then(r => setTrips(r.data))
                .catch(console.error)
                .finally(() => setLoading(false));
        }
    }, [selectedEmployee, date, view]);

    // Cargar direcciones en vivo
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

    // 🔑 FETCH CON SIMPLIFICACIÓN DE POLYLINE
    const fetchTripDetails = async (trip) => {
        setPlayback(false);
        setLoading(true);
        try {
            const { data } = await api.get(`/api/trips/${trip.id}`);
            
            // ⚡ SIMPLIFICAR 10,000 puntos → 200
            const simplifiedPoints = simplifyPolyline(data.points, 0.0008);
            
            setRouteData({
                ...data,
                points: simplifiedPoints,
                originalPointsCount: data.points.length
            });
            
            setTrip(trip);
            
            // Cargar direcciones
            const newAddresses = {};
            if (simplifiedPoints.length > 0) {
                const startPoint = simplifiedPoints[0];
                newAddresses[`start-${trip.id}`] = await getAddress(startPoint.lat, startPoint.lng);
                
                const endPoint = simplifiedPoints[simplifiedPoints.length - 1];
                newAddresses[`end-${trip.id}`] = await getAddress(endPoint.lat, endPoint.lng);
                
                for (let i = 0; i < data.stops.length; i++) {
                    const stop = data.stops[i];
                    newAddresses[`stop-${trip.id}-${i}`] = await getAddress(stop.lat, stop.lng);
                }
            }
            setAddresses(newAddresses);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
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
                            {loading && <div className="no-trips">Cargando viajes...</div>}
                            {!loading && trips.length === 0 && <div className="no-trips">Sin viajes registrados.</div>}
                            {!loading && trips.map(t => (
                                <div key={t.id} className="trip-pill" onClick={() => fetchTripDetails(t)}>
                                    <span className="trip-time">⌚ {dayjs(t.start_time).format('hh:mm A')}</span>
                                    <span className="trip-dist">🛣️ {(t.distance_meters / 1000).toFixed(2)} km</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="trip-details">
                            <button className="back-btn" onClick={() => setRouteData(null)}>
                                ← Volver a lista
                            </button>

                            {/* STATS SEPARADAS */}
                            <div className="trip-stats-section">
                                <h4 className="section-title">📍 TRAYECTO</h4>
                                <div className="stat-row">
                                    <div className="stat">Distancia</div>
                                    <div className="stat-value">{(selectedTrip.distance_meters / 1000).toFixed(2)} km</div>
                                </div>
                                <div className="stat-row">
                                    <div className="stat">Puntos GPS</div>
                                    <div className="stat-value">{routeData.originalPointsCount} (mostrados: {routeData.points.length})</div>
                                </div>
                                <div className="stat-row">
                                    <div className="stat">Duración</div>
                                    <div className="stat-value">
                                        {dayjs(selectedTrip.end_time).diff(dayjs(selectedTrip.start_time), 'hour')}h {dayjs(selectedTrip.end_time).diff(dayjs(selectedTrip.start_time), 'minute') % 60}m
                                    </div>
                                </div>
                            </div>

                            {/* PARADAS SEPARADAS */}
                            {routeData.stops?.length > 0 && (
                                <div className="trip-stats-section">
                                    <h4 className="section-title">🛑 PARADAS ({routeData.stops.length})</h4>
                                    <div className="stops-list">
                                        {routeData.stops.map((stop, i) => (
                                            <div key={i} className="stop-item">
                                                <div className="stop-header">
                                                    <span className="stop-num">Parada {i + 1}</span>
                                                    <span className="stop-duration">⏱ {Math.round(stop.duration_seconds / 60)} min</span>
                                                </div>
                                                <div className="stop-address">
                                                    📍 {addresses[`stop-${selectedTrip.id}-${i}`] || 'Cargando...'}
                                                </div>
                                                {/* 🔑 BOTÓN GOOGLE MAPS */}
                                                <a
                                                    href={formatGoogleMapsUrl(stop.lat, stop.lng)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="google-maps-btn"
                                                >
                                                    🗺️ Ver en Google Maps
                                                </a>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button
                                className={`map-action-btn ${playbackMode ? 'active' : ''}`}
                                onClick={() => setPlayback(!playbackMode)}
                            >
                                {playbackMode ? '⏹ Detener Playback' : '▶ Reproducir Ruta'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* LEGEND */}
            {view === 'live' && (
                <div className="map-legend">
                    <div className="legend-dot active-dot" /> Activos ({livePositions.length})
                </div>
            )}

            <MapContainer
                center={[-12.0464, -77.0428]}
                zoom={17}
                minZoom={10}
                maxZoom={19}
                zoomControl={false}
                style={{ height: '100%', width: '100%', backgroundColor: '#1A1A2E' }}
            >
                <TileLayer 
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" 
                    attribution="&copy; <a href='https://carto.com/'>carto</a>" 
                    subdomains={['a', 'b', 'c', 'd']}
                    maxNativeZoom={18}
                    minZoom={10}
                    maxZoom={19}
                />
                <TileLayer 
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; <a href='https://osm.org/'>OpenStreetMap</a>"
                    minZoom={19}
                    maxZoom={19}
                />

                {/* LIVE MODE */}
                {view === 'live' && (
                    <>
                        <LivePolyline activeLocations={livePositions} />
                        {livePositions.map(loc => {
                            const addr = addresses[`live-${loc.employeeId}`] || 'Obteniendo...';
                            return (
                                <Marker key={loc.employeeId} position={[loc.lat, loc.lng]} icon={activeIcon}>
                                    <Popup>
                                        <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                            <strong>{loc.name || `Vendedor ${loc.employeeId}`}</strong>
                                            <br />
                                            📍 {addr}
                                            <br />
                                            🕒 {dayjs(loc.lastUpdate).format('HH:mm:ss')}
                                            <br />
                                            📈 {loc.speed ? (loc.speed.toFixed(1) + ' km/h') : 'Detenido'}
                                            <br />
                                            <a href={formatGoogleMapsUrl(loc.lat, loc.lng)} target="_blank" rel="noopener noreferrer"
                                                style={{ color: '#2563eb', fontSize: '11px' }}>
                                                🗺️ Google Maps
                                            </a>
                                        </div>
                                    </Popup>
                                </Marker>
                            );
                        })}
                    </>
                )}

                {/* HISTORY MODE */}
                {view === 'history' && routeData && !playbackMode && (
                    <>
                        <FitBounds positions={routeData.points} />
                        
                        {/* Polyline del trayecto */}
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
                                        <strong>🚀 Inicio</strong><br />
                                        📍 {addresses[`start-${selectedTrip.id}`] || 'Cargando...'}
                                    </div>
                                </Popup>
                            </Marker>
                        )}
                        
                        {/* End marker */}
                        {routeData.points.length > 1 && (
                            <Marker position={[routeData.points.at(-1).lat, routeData.points.at(-1).lng]}>
                                <Popup>
                                    <div style={{ fontSize: '12px', minWidth: '220px' }}>
                                        <strong>🏁 Fin</strong><br />
                                        📍 {addresses[`end-${selectedTrip.id}`] || 'Cargando...'}
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
                                        📍 {addresses[`stop-${selectedTrip.id}-${i}`] || 'Cargando...'}
                                        <br />
                                        ⏱ {Math.round(s.duration_seconds / 60)} min
                                        <br />
                                        <a href={formatGoogleMapsUrl(s.lat, s.lng)} target="_blank" rel="noopener noreferrer"
                                            style={{ color: '#2563eb', fontSize: '11px' }}>
                                            🗺️ Google Maps
                                        </a>
                                    </div>
                                </Popup>
                            </Marker>
                        ))}
                    </>
                )}

                {/* PLAYBACK MODE */}
                {view === 'history' && routeData && playbackMode && (
                    <Playback points={routeData.points} />
                )}

                <ZoomControls />
            </MapContainer>

            <style>{`
        @keyframes pulse { 0% { transform:scale(1); opacity:.6 } 100% { transform:scale(2.5); opacity:0 } }

        .history-sidepanel {
          position: absolute; top: 12px; left: 56px; z-index: 1000;
          background: #ffffff; padding: 20px; border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,.15); width: 340px;
          display: flex; flex-direction: column; max-height: 90vh;
          overflow-y: auto;
        }
        
        .hs-title { margin: 0; font-size: 16px; font-weight: 700; color: #1e293b; }
        .hs-employee { font-size: 14px; color: #64748b; margin: 4px 0 16px 0; font-weight: 500; }
        .hs-date-picker { 
          margin-bottom: 16px; width: 100%; padding: 10px 12px; 
          border-radius: 10px; border: 1px solid #cbd5e1; 
          font-size: 14px; background: #f8fafc; outline: none; 
        }
        .hs-date-picker:focus { border-color: #6C63FF; }
        
        .trip-list-overlay { display: flex; flex-direction: column; gap: 8px; }
        .no-trips { font-size: 13px; color: #94a3b8; padding: 8px 0; text-align: center; }
        .trip-pill {
          display: flex; flex-direction: column; gap: 4px; padding: 12px; 
          border-radius: 10px; cursor: pointer; background: #f8fafc; 
          font-size: 13px; border: 1px solid #e2e8f0; transition: all .2s;
        }
        .trip-pill:hover { border-color: #6C63FF; background: #f1f5f9; }
        .trip-time { font-weight: 600; color: #1e293b; }
        .trip-dist { font-size: 12px; color: #64748b; }

        .trip-details { display: flex; flex-direction: column; gap: 12px; }
        .back-btn { 
          background: none; border: none; padding: 0; 
          color: #6C63FF; font-size: 13px; font-weight: 600; 
          cursor: pointer; text-align: left; margin-bottom: 8px;
        }
        
        .trip-stats-section {
          padding: 12px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0;
        }
        .section-title {
          font-size: 12px; font-weight: 600; text-transform: uppercase;
          color: #64748b; margin: 0 0 10px 0; letter-spacing: 0.5px;
        }
        .stat-row {
          display: flex; justify-content: space-between; padding: 6px 0;
          border-bottom: 1px solid #e2e8f0; font-size: 12px;
        }
        .stat-row:last-child { border-bottom: none; }
        .stat { color: #64748b; font-weight: 500; }
        .stat-value { color: #1e293b; font-weight: 600; }

        .stops-list { display: flex; flex-direction: column; gap: 8px; max-height: 250px; overflow-y: auto; }
        .stop-item {
          padding: 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
        }
        .stop-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .stop-num { font-size: 12px; font-weight: 600; color: #1e293b; }
        .stop-duration { font-size: 11px; color: #f59e0b; font-weight: 600; }
        .stop-address { font-size: 11px; color: #64748b; margin-bottom: 6px; line-height: 1.4; }
        
        .google-maps-btn {
          display: inline-block; font-size: 11px; padding: 4px 8px;
          background: #eff6ff; color: #2563eb; text-decoration: none; border-radius: 6px;
          border: 1px solid #bfdbfe; transition: all 0.2s; font-weight: 600;
        }
        .google-maps-btn:hover { background: #dbeafe; border-color: #2563eb; }

        .map-action-btn {
          width: 100%; padding: 12px; background: #f1f5f9; 
          border: none; border-radius: 10px; cursor: pointer; 
          font-size: 13px; font-weight: 600; color: #1e293b; 
          transition: all 0.2s; margin-top: 8px;
        }
        .map-action-btn.active { background: #6C63FF; color: white; box-shadow: 0 4px 12px rgba(108,99,255,0.3); }
        .map-action-btn:hover { background: #e2e8f0; }
        .map-action-btn.active:hover { background: #6C63FF; }

        .map-legend {
          position: absolute; top: 12px; right: 12px; z-index: 1000;
          background: white; padding: 8px 14px; border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,.1); font-size: 13px; color: #1e293b;
          display: flex; align-items: center; gap: 8px;
        }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .active-dot { background: #2563eb; }

        .zoom-btn {
          width: 44px; height: 44px; border: none; border-radius: 8px;
          background: white; color: #0f172a; font-size: 20px; font-weight: bold;
          cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2);
          transition: all 0.2s; display: flex; align-items: center; justify-content: center;
        }
        .zoom-btn:hover { background: #f1f5f9; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
        .zoom-btn:active { transform: scale(0.95); }

        @media (max-width: 768px) {
          .history-sidepanel { 
            position: fixed; top: 50px; left: 0; right: 0; 
            width: 100%; max-height: calc(100vh - 50px);
            border-radius: 0; z-index: 950; max-width: 100%; padding: 16px;
          }
          .zoom-btn { width: 40px; height: 40px; font-size: 18px; }
        }

        @media (max-width: 480px) {
          .history-sidepanel { padding: 12px; top: 44px; max-height: calc(100vh - 44px); }
          .hs-title { font-size: 13px; }
          .zoom-btn { width: 36px; height: 36px; font-size: 16px; }
          .stop-item { padding: 8px; }
          .google-maps-btn { font-size: 10px; padding: 3px 6px; }
        }
      `}</style>
        </div>
    );
};

export default MapView;
