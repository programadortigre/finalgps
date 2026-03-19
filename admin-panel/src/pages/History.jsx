import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, ChevronRight, ArrowLeft, Loader, AlertCircle, CalendarDays, ChevronDown, ChevronUp, X } from 'lucide-react';
import api from '../services/api';
import MapView from '../components/MapView';

const History = ({ user }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);  // ✅ FIX: Incluir también mañana para atrapar viajes con timezone offset
        return d.toISOString().split('T')[0];
    });

    const [trips, setTrips] = useState([]);
    const [stops, setStops] = useState([]);
    const [events, setEvents] = useState([]);
    const [activeTab, setActiveTab] = useState('trips');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedTrip, setSelectedTrip] = useState(null);
    const [tripDetails, setTripDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(true);
    const [filtersExpanded, setFiltersExpanded] = useState(true);
    const [routeMode, setRouteMode] = useState('pro'); // raw, smooth, pro

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const { data } = await api.get('/api/trips/employees');
                setEmployees(data);
                // ✅ FIX: Preseleccionar el primer empleado al cargar
                // Esperar a que data esté disponible antes de preseleccionar
                if (data.length > 0) {
                    setSelectedEmployee(data[0].id);
                }
            } catch (err) {
                setError('Error al cargar vendedores');
            }
        };
        fetchEmployees();
    }, []);

    useEffect(() => {
        if (!selectedEmployee) return;
        fetchHistory();
    }, [selectedEmployee, startDate, endDate]);

    const fetchHistory = async () => {
        setLoading(true);
        setError('');
        try {
            const [tripsRes, stopsRes, eventsRes] = await Promise.all([
                api.get(`/api/trips/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}`),
                api.get(`/api/trips/stops/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}`),
                api.get(`/api/trips/events/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}`)
            ]);
            setTrips(tripsRes.data.trips || []);
            setStops(stopsRes.data.stops || []);
            setEvents(eventsRes.data.events || []);
        } catch (err) {
            setError('Error al cargar historial: ' + (err.response?.data?.error || err.message));
            setTrips([]);
            setStops([]);
            setEvents([]);
        }
        setLoading(false);
    };

    const fetchTripDetails = async (tripId) => {
        setLoadingDetails(true);
        try {
            const { data } = await api.get(`/api/trips/${tripId}?mode=${routeMode}`);
            setTripDetails(data);
        } catch (err) {
            setError('Error al cargar detalles del viaje');
        }
        setLoadingDetails(false);
    };

    const handleTripClick = (trip) => {
        setSelectedTrip(trip);
        fetchTripDetails(trip.id);
        setDrawerOpen(false);
    };

    const handleBack = () => {
        setSelectedTrip(null);
        setTripDetails(null);
        setDrawerOpen(true);
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('es-PE');
    };

    const formatDuration = (seconds) => {
        if (!seconds) return '-';
        const mins = Math.floor(seconds / 60);
        if (mins > 60) {
            const hours = Math.floor(mins / 60);
            return `${hours}h ${mins % 60}m`;
        }
        return `${mins}m ${seconds % 60}s`;
    };

    return (
        <div className="hist-layout">

            {/* Full-screen map */}
            <div className="hist-map-full">
                {selectedTrip && tripDetails ? (
                    loadingDetails ? (
                        <div className="hist-map-loading">
                            <Loader className="spin" size={36} />
                            <span>Cargando ruta...</span>
                        </div>
                    ) : (
                        <MapView
                            view="history"
                            selectedEmployee={employees.find(e => e.id === selectedEmployee) || null}
                            selectedTrip={selectedTrip}
                            tripDetails={tripDetails}
                            routeMode={routeMode}
                        />
                    )
                ) : (
                    <MapView
                        view="history"
                        selectedEmployee={employees.find(e => e.id === selectedEmployee) || null}
                        trips={trips}
                        stops={stops}
                        routeMode={routeMode}
                    />
                )}
            </div>

            {/* Floating filter bar */}
            <div className="hist-filterbar">
                {selectedTrip ? (
                    /* Trip detail header */
                    <div className="hist-detail-bar">
                        <button className="hist-back-btn" onClick={handleBack}>
                            <ArrowLeft size={16} /> Volver
                        </button>
                        <div className="hist-detail-info">
                            <span className="hist-detail-title">
                                {employees.find(e => e.id === selectedEmployee)?.name || 'Vendedor'}
                            </span>
                            <span className="hist-detail-meta">
                                {formatDate(selectedTrip.start_time)} · {formatTime(selectedTrip.start_time)} – {formatTime(selectedTrip.end_time)}
                            </span>
                        </div>
                        <div className="hist-mini-stats">
                            <div className="hist-mini-stat">
                                <span className="hist-mini-label">Distancia</span>
                                <span className="hist-mini-value">{(selectedTrip.distance_meters / 1000).toFixed(2)} km</span>
                            </div>
                            <div className="hist-mini-stat">
                                <span className="hist-mini-label">Duración</span>
                                <span className="hist-mini-value">{selectedTrip.duration_hours} h</span>
                            </div>
                            <div className="hist-mini-stat">
                                <span className="hist-mini-label">Paradas</span>
                                <span className="hist-mini-value">{selectedTrip.stop_count}</span>
                            </div>
                            <div className="hist-mini-stat">
                                <span className="hist-mini-label">Puntos GPS</span>
                                <span className="hist-mini-value">{selectedTrip.point_count}</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Filter controls */
                    <div className="hist-filters">
                        <div className="hist-filter-row">
                            <CalendarDays size={16} style={{ color: '#60a5fa', flexShrink: 0 }} />
                            <span className="hist-filter-label">Historial</span>

                            <div className="hist-filter-group">
                                <label className="hist-field-label">Vendedor</label>
                                <select
                                    value={selectedEmployee || ''}
                                    onChange={(e) => setSelectedEmployee(parseInt(e.target.value))}
                                    className="hist-select"
                                >
                                    <option value="">Seleccionar...</option>
                                    {employees.map(emp => (
                                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="hist-filter-group">
                                <label className="hist-field-label">Desde</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="hist-input"
                                />
                            </div>

                            <div className="hist-filter-group">
                                <label className="hist-field-label">Hasta</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="hist-input"
                                />
                            </div>

                            <div className="hist-filter-group">
                                <label className="hist-field-label">Filtro Ruta</label>
                                <select
                                    value={routeMode}
                                    onChange={(e) => setRouteMode(e.target.value)}
                                    className="hist-select"
                                    style={{ borderLeft: '2px solid #6366f1' }}
                                >
                                    <option value="raw">Crudo (Todo)</option>
                                    <option value="smooth">Suave (Anti-Jitter)</option>
                                    <option value="pro">Optimizado (Pro)</option>
                                </select>
                            </div>

                            <button className="hist-refresh-btn" onClick={fetchHistory}>
                                Actualizar
                            </button>
                        </div>

                        {error && (
                            <div className="hist-error">
                                <AlertCircle size={14} /> {error}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom drawer */}
            <div className={`hist-drawer ${drawerOpen ? 'open' : 'collapsed'}`}>
                {/* Drawer handle */}
                <button className="hist-drawer-handle" onClick={() => setDrawerOpen(!drawerOpen)}>
                    <div className="hist-handle-bar" />
                    {drawerOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    <span className="hist-drawer-title">
                        {selectedTrip
                            ? `Paradas (${tripDetails?.stops?.length ?? 0})`
                            : `${activeTab === 'trips' ? 'Recorridos' : activeTab === 'events' ? 'Eventos' : 'Paradas'} · ${activeTab === 'trips' ? trips.length : activeTab === 'events' ? events.length : stops.length}`
                        }
                    </span>
                    {drawerOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>

                <div className="hist-drawer-body">
                    {selectedTrip && tripDetails ? (
                        /* Stops detail list */
                        <div className="hist-stops-detail">
                            {tripDetails.stops?.length > 0 ? (
                                <table className="hist-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Inicio</th>
                                            <th>Fin</th>
                                            <th>Duración</th>
                                            <th>Ubicación</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tripDetails.stops.map((stop, idx) => (
                                            <tr key={idx}>
                                                <td><span className="hist-stop-num">{idx + 1}</span></td>
                                                <td>{formatTime(stop.start_time)}</td>
                                                <td>{formatTime(stop.end_time)}</td>
                                                <td><span className="hist-duration">{formatDuration(stop.duration_seconds)}</span></td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span className="hist-coord" style={{ fontSize: '11px', opacity: 0.7 }}>
                                                            {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
                                                        </span>
                                                        <a 
                                                            href={`https://www.google.com/maps?q=${stop.lat},${stop.lng}`}
                                                            target="_blank" rel="noopener noreferrer" 
                                                            className="gmaps-link-small"
                                                            style={{ 
                                                                padding: '4px 8px', fontSize: '10px', background: 'rgba(255,255,255,0.05)', 
                                                                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                                                                color: '#60a5fa', textDecoration: 'none', fontWeight: '600'
                                                            }}
                                                        >
                                                            🗺️ Ver Maps
                                                        </a>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="hist-empty">🛑 Sin paradas en este viaje</div>
                            )}
                        </div>
                    ) : (
                        /* Trips / Stops list */
                        <>
                            <div className="hist-tabs">
                                <button
                                    className={`hist-tab ${activeTab === 'trips' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('trips')}
                                >
                                    <Clock size={15} /> Recorridos
                                    <span className="hist-tab-badge">{trips.length}</span>
                                </button>
                                <button
                                    className={`hist-tab ${activeTab === 'stops' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('stops')}
                                >
                                    <MapPin size={15} /> Paradas
                                    <span className="hist-tab-badge">{stops.length}</span>
                                </button>
                                <button
                                    className={`hist-tab ${activeTab === 'events' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('events')}
                                >
                                    <AlertCircle size={15} /> Eventos GPS
                                    <span className="hist-tab-badge">{events.length}</span>
                                </button>
                            </div>

                            {loading ? (
                                <div className="hist-loading">
                                    <Loader className="spin" size={28} /> Cargando...
                                </div>
                            ) : activeTab === 'trips' ? (
                                trips.length === 0 ? (
                                    <div className="hist-empty">🗺️ No hay recorridos en este período</div>
                                ) : (
                                    <div className="hist-trips-grid">
                                        {trips.map(trip => (
                                            <button
                                                key={trip.id}
                                                className="hist-trip-card"
                                                onClick={() => handleTripClick(trip)}
                                            >
                                                <div className="hist-trip-date-row">
                                                    <span className="hist-trip-date">{formatDate(trip.start_time)}</span>
                                                    <span className="hist-trip-time">{formatTime(trip.start_time)} – {formatTime(trip.end_time)}</span>
                                                </div>
                                                <div className="hist-trip-stats">
                                                    <div className="hist-trip-stat">
                                                        <span className="tsl">Distancia</span>
                                                        <span className="tsv">{(trip.distance_meters / 1000).toFixed(2)} km</span>
                                                    </div>
                                                    <div className="hist-trip-stat">
                                                        <span className="tsl">Duración</span>
                                                        <span className="tsv">{trip.duration_hours} h</span>
                                                    </div>
                                                    <div className="hist-trip-stat">
                                                        <span className="tsl">Paradas</span>
                                                        <span className="tsv">{trip.stop_count}</span>
                                                    </div>
                                                </div>
                                                <div className="hist-trip-view">
                                                    Ver ruta <ChevronRight size={14} />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )
                            ) : activeTab === 'stops' ? (
                                stops.length === 0 ? (
                                    <div className="hist-empty">📍 No hay paradas en este período</div>
                                ) : (
                                    <div className="hist-table-wrap">
                                        <table className="hist-table">
                                            <thead>
                                                <tr>
                                                    <th>Fecha</th>
                                                    <th>Inicio</th>
                                                    <th>Fin</th>
                                                    <th>Duración</th>
                                                    <th>Ubicación</th>
                                                    <th></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {stops.map((stop, idx) => (
                                                    <tr key={idx}>
                                                        <td>{formatDate(stop.start_time)}</td>
                                                        <td>{formatTime(stop.start_time)}</td>
                                                        <td>{formatTime(stop.end_time)}</td>
                                                        <td><span className="hist-duration">{formatDuration(stop.duration_seconds)}</span></td>
                                                        <td>
                                                            <span className="hist-coord">
                                                                {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <button
                                                                className="hist-view-btn"
                                                                onClick={() => {
                                                                    const trip = trips.find(t => t.id === stop.trip_id);
                                                                    if (trip) handleTripClick(trip);
                                                                }}
                                                            >
                                                                Ver
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )
                            ) : activeTab === 'events' ? (
                                events.length === 0 ? (
                                    <div className="hist-empty">✨ No hay eventos de desconexión en este período</div>
                                ) : (
                                    <div className="hist-table-wrap">
                                        <table className="hist-table">
                                            <thead>
                                                <tr>
                                                    <th>Fecha</th>
                                                    <th>Hora</th>
                                                    <th>Evento</th>
                                                    <th>Estado / Razón</th>
                                                    <th>Duración apagado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {events.map((ev, idx) => (
                                                    <tr key={idx}>
                                                        <td>{formatDate(ev.timestamp)}</td>
                                                        <td>{formatTime(ev.timestamp)}</td>
                                                        <td>
                                                            <span className="hist-duration" style={{
                                                                background: ev.event_type === 'GPS_OFF' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                                                                color: ev.event_type === 'GPS_OFF' ? '#ef4444' : '#22c55e'
                                                            }}>
                                                                {ev.event_type === 'GPS_OFF' ? '⛔ GPS OFF' : '✅ GPS ON'}
                                                            </span>
                                                        </td>
                                                        <td style={{opacity: 0.8}}>{ev.state} {ev.reset_reason ? `(${ev.reset_reason})` : ''}</td>
                                                        <td>{ev.duration_off_seconds ? <span className="hist-coord">{formatDuration(ev.duration_off_seconds)}</span> : '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )
                            ) : null}
                        </>
                    )}
                </div>
            </div>

            <style>{`
                .hist-layout {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    font-family: 'Inter', system-ui, sans-serif;
                    background: #0f172a;
                }

                /* Full-screen map */
                .hist-map-full {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 0;
                }

                .hist-map-loading {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    background: #0f172a;
                    color: #94a3b8;
                    font-size: 14px;
                }

                /* ─── Filter Bar ─── */
                .hist-filterbar {
                    position: absolute;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 50;
                    background: rgba(15, 23, 42, 0.7) !important;
                    backdrop-filter: blur(16px) saturate(180%) !important;
                    -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    border-radius: 20px;
                    padding: 16px 24px;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.4);
                    max-width: calc(100vw - 40px);
                    min-width: min(800px, calc(100vw - 40px));
                }

                .hist-filter-row {
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    flex-wrap: wrap;
                }

                .hist-filter-label {
                    font-size: 16px;
                    font-weight: 700;
                    color: #fff;
                    font-family: 'Outfit', sans-serif;
                    letter-spacing: -0.02em;
                }

                .hist-filter-group {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .hist-field-label {
                    font-size: 11px;
                    color: #94a3b8;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .hist-select, .hist-input {
                    padding: 10px 14px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    color: #fff;
                    font-size: 13px;
                    outline: none;
                    transition: all 0.2s;
                }
                .hist-select:focus, .hist-input:focus {
                    border-color: #3b82f6;
                    background: rgba(255, 255, 255, 0.1);
                }

                .hist-refresh-btn {
                    padding: 10px 20px;
                    background: #2563eb;
                    border: none;
                    border-radius: 12px;
                    color: white;
                    font-size: 13px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
                }
                .hist-refresh-btn:hover { background: #1d4ed8; transform: translateY(-1px); }

                /* ─── Bottom Drawer ─── */
                .hist-drawer {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    z-index: 50;
                    background: rgba(15, 23, 42, 0.8) !important;
                    backdrop-filter: blur(20px) saturate(180%) !important;
                    -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
                    border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
                    border-radius: 30px 30px 0 0;
                    box-shadow: 0 -20px 50px rgba(0,0,0,0.5);
                    display: flex;
                    flex-direction: column;
                    transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .hist-drawer.open { height: 50%; }
                .hist-drawer.collapsed { height: 60px; }

                .hist-drawer-handle {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    padding: 15px 24px;
                    background: transparent;
                    border: none;
                    color: #94a3b8;
                    cursor: pointer;
                    min-height: 60px;
                }

                .hist-handle-bar {
                    width: 40px;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 2px;
                    position: absolute;
                    top: 10px;
                }

                .hist-drawer-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px 30px;
                }

                /* ─── Tabs ─── */
                .hist-tabs {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 14px;
                    padding: 4px;
                    background: rgba(255,255,255,0.04);
                    border-radius: 10px;
                    width: fit-content;
                }

                .hist-tab {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: transparent;
                    border: none;
                    border-radius: 7px;
                    color: #64748b;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    transition: all 0.15s;
                }
                .hist-tab:hover { color: #e2e8f0; }
                .hist-tab.active { background: #2563eb; color: white; }

                .hist-tab-badge {
                    background: rgba(255,255,255,0.15);
                    padding: 1px 7px;
                    border-radius: 999px;
                    font-size: 11px;
                }
                .hist-tab.active .hist-tab-badge { background: rgba(255,255,255,0.2); }

                /* ─── Loading / Empty ─── */
                .hist-loading {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    justify-content: center;
                    padding: 40px;
                    color: #64748b;
                    font-size: 14px;
                }

                .hist-empty {
                    text-align: center;
                    color: #475569;
                    font-size: 14px;
                    padding: 40px 16px;
                }

                /* ─── Trips grid ─── */
                .hist-trips-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                    gap: 10px;
                }

                .hist-trip-card {
                    background: rgba(255,255,255,0.04);
                    border: 1px solid rgba(255,255,255,0.07);
                    border-radius: 12px;
                    padding: 14px;
                    cursor: pointer;
                    text-align: left;
                    font-family: inherit;
                    transition: all 0.15s;
                }
                .hist-trip-card:hover {
                    background: rgba(255,255,255,0.08);
                    border-color: #3b82f6;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 16px rgba(37,99,235,0.2);
                }

                .hist-trip-date-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid rgba(255,255,255,0.06);
                }

                .hist-trip-date {
                    font-size: 13px;
                    font-weight: 700;
                    color: #e2e8f0;
                }

                .hist-trip-time {
                    font-size: 11px;
                    color: #64748b;
                }

                .hist-trip-stats {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 6px;
                    margin-bottom: 10px;
                }

                .hist-trip-stat {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .tsl {
                    font-size: 10px;
                    color: #475569;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .tsv {
                    font-size: 13px;
                    font-weight: 700;
                    color: #e2e8f0;
                }

                .hist-trip-view {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    font-size: 12px;
                    color: #60a5fa;
                    font-weight: 600;
                    padding-top: 8px;
                    border-top: 1px solid rgba(255,255,255,0.06);
                }

                /* ─── Table ─── */
                .hist-table-wrap {
                    overflow-x: auto;
                    border-radius: 10px;
                    border: 1px solid rgba(255,255,255,0.06);
                }

                .hist-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }

                .hist-table th {
                    background: rgba(255,255,255,0.04);
                    padding: 10px 14px;
                    text-align: left;
                    font-size: 11px;
                    font-weight: 600;
                    color: #475569;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    white-space: nowrap;
                }

                .hist-table td {
                    padding: 10px 14px;
                    border-top: 1px solid rgba(255,255,255,0.04);
                    color: #cbd5e1;
                }

                .hist-table tr:hover td { background: rgba(255,255,255,0.03); }

                .hist-stop-num {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 22px;
                    height: 22px;
                    background: rgba(37,99,235,0.25);
                    color: #93c5fd;
                    border-radius: 50%;
                    font-size: 11px;
                    font-weight: 700;
                }

                .hist-duration {
                    display: inline-block;
                    padding: 3px 8px;
                    background: rgba(245,158,11,0.15);
                    color: #fbbf24;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 600;
                }

                .hist-coord {
                    display: inline-block;
                    padding: 3px 8px;
                    background: rgba(37,99,235,0.15);
                    color: #93c5fd;
                    border-radius: 6px;
                    font-size: 11px;
                    font-family: monospace;
                }

                .hist-view-btn {
                    padding: 5px 12px;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 7px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    transition: background 0.15s;
                }
                .hist-view-btn:hover { background: #1d4ed8; }

                /* ─── Stops detail in drawer ─── */
                .hist-stops-detail { width: 100%; }

                /* ─── Spinner ─── */
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

                /* ─── Mobile ─── */
                @media (max-width: 640px) {
                    .hist-filterbar { padding: 10px 12px; border-radius: 12px; }
                    .hist-filter-row { gap: 8px; }
                    .hist-mini-stats { gap: 10px; }
                    .hist-drawer.open { height: 55%; max-height: 60vh; }
                    .hist-trips-grid { grid-template-columns: 1fr; }
                }
            `}</style>
        </div>
    );
};

export default History;
