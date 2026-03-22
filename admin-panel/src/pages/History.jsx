import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Calendar, Clock, MapPin, ChevronRight, ArrowLeft, Loader, AlertCircle, CalendarDays, ChevronDown, ChevronUp, X, TrendingUp, Briefcase } from 'lucide-react';
import api from '../services/api';
import MapView from '../components/MapView';

// ✅ Componente memoizado para tarjeta de viaje
const TripCard = memo(({ trip, onClick, employee }) => (
    <div className="trip-card" onClick={onClick}>
        <div className="trip-header">
            <div className="trip-badge">{trip.trip_date}</div>
            <div className="trip-time-range">
                <Clock size={14} />
                <span>{trip.start_time_formatted} → {trip.end_time_formatted}</span>
            </div>
        </div>
        <div className="trip-content">
            <div className="trip-metric">
                <div className="metric-label">Distancia</div>
                <div className="metric-value">{trip.distance_km} km</div>
            </div>
            <div className="trip-metric">
                <div className="metric-label">Duración</div>
                <div className="metric-value">{trip.duration_hours}h</div>
            </div>
            <div className="trip-metric">
                <div className="metric-label">Paradas</div>
                <div className="metric-value">{trip.stop_count}</div>
            </div>
        </div>
        <div className="trip-footer">
            Ver detalles <ChevronRight size={16} />
        </div>
    </div>
));
TripCard.displayName = 'TripCard';

// ✅ Componente memoizado para fila de parada
const StopRow = memo(({ stop }) => (
    <div className="stop-row">
        <div className="stop-time">
            <div className="stop-date-badge">{stop.stop_date}</div>
            <div className="stop-time-badge">{stop.start_time_formatted}</div>
        </div>
        <div className="stop-duration">{stop.duration_formatted}</div>
        <div className="stop-location">
            <MapPin size={13} />
            <code>{stop.latitude}, {stop.longitude}</code>
        </div>
    </div>
));
StopRow.displayName = 'StopRow';

// ✅ Componente memoizado para fila de evento
const EventRow = memo(({ event }) => (
    <div className="event-row">
        <div className="event-date">{event.event_date}</div>
        <div className="event-time">{event.event_time}</div>
        <div className={`event-badge ${event.event_type === 'GPS_OFF' ? 'off' : 'on'}`}>
            {event.event_type === 'GPS_OFF' ? '⛔ OFF' : '✅ ON'}
        </div>
        <div className="event-reason">{event.state}</div>
        {event.duration_off_formatted && <div className="event-duration">{event.duration_off_formatted}</div>}
    </div>
));
EventRow.displayName = 'EventRow';

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
        d.setDate(d.getDate() + 1);
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

    const [tripsPage, setTripsPage] = useState(1);
    const [stopsPage, setStopsPage] = useState(1);
    const [eventsPage, setEventsPage] = useState(1);
    const itemsPerPage = 50;

    const [paginationInfo, setPaginationInfo] = useState({
        trips: { total: 0, hasMore: false },
        stops: { total: 0, hasMore: false },
        events: { total: 0, hasMore: false }
    });

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const { data } = await api.get('/api/trips/employees');
                setEmployees(data);
                if (data.length > 0) {
                    setSelectedEmployee(data[0].id);
                }
            } catch (err) {
                setError('Error al cargar vendedores');
            }
        };
        fetchEmployees();
    }, []);

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        setError('');
        setTripsPage(1);
        setStopsPage(1);
        setEventsPage(1);
        
        if (!selectedEmployee) {
            setLoading(false);
            return;
        }

        try {
            const [tripsRes, stopsRes, eventsRes] = await Promise.all([
                api.get(`/api/trips/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=1&limit=${itemsPerPage}`),
                api.get(`/api/trips/stops/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=1&limit=${itemsPerPage}`),
                api.get(`/api/trips/events/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=1&limit=${itemsPerPage}`)
            ]);
            
            setTrips(tripsRes.data.trips || []);
            setStops(stopsRes.data.stops || []);
            setEvents(eventsRes.data.events || []);

            setPaginationInfo({
                trips: { total: tripsRes.data.total || 0, hasMore: tripsRes.data.hasMore || false },
                stops: { total: stopsRes.data.total || 0, hasMore: stopsRes.data.hasMore || false },
                events: { total: eventsRes.data.total || 0, hasMore: eventsRes.data.hasMore || false }
            });
        } catch (err) {
            setError('Error al cargar historial: ' + (err.response?.data?.error || err.message));
            setTrips([]);
            setStops([]);
            setEvents([]);
        }
        setLoading(false);
    }, [selectedEmployee, startDate, endDate]);

    useEffect(() => {
        if (!selectedEmployee) return;
        fetchHistory();
    }, [selectedEmployee, startDate, endDate, fetchHistory]);

    const loadMoreTrips = useCallback(async () => {
        if (loading) return;
        const nextPage = tripsPage + 1;
        try {
            const { data } = await api.get(`/api/trips/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=${nextPage}&limit=${itemsPerPage}`);
            setTrips(prev => [...prev, ...(data.trips || [])]);
            setTripsPage(nextPage);
            setPaginationInfo(prev => ({
                ...prev,
                trips: { total: data.total, hasMore: data.hasMore }
            }));
        } catch (err) {
            setError('Error al cargar más viajes');
        }
    }, [selectedEmployee, startDate, endDate, tripsPage, loading]);

    const loadMoreStops = useCallback(async () => {
        if (loading) return;
        const nextPage = stopsPage + 1;
        try {
            const { data } = await api.get(`/api/trips/stops/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=${nextPage}&limit=${itemsPerPage}`);
            setStops(prev => [...prev, ...(data.stops || [])]);
            setStopsPage(nextPage);
            setPaginationInfo(prev => ({
                ...prev,
                stops: { total: data.total, hasMore: data.hasMore }
            }));
        } catch (err) {
            setError('Error al cargar más paradas');
        }
    }, [selectedEmployee, startDate, endDate, stopsPage, loading]);

    const loadMoreEvents = useCallback(async () => {
        if (loading) return;
        const nextPage = eventsPage + 1;
        try {
            const { data } = await api.get(`/api/trips/events/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=${nextPage}&limit=${itemsPerPage}`);
            setEvents(prev => [...prev, ...(data.events || [])]);
            setEventsPage(nextPage);
            setPaginationInfo(prev => ({
                ...prev,
                events: { total: data.total, hasMore: data.hasMore }
            }));
        } catch (err) {
            setError('Error al cargar más eventos');
        }
    }, [selectedEmployee, startDate, endDate, eventsPage, loading]);

    const fetchTripDetails = useCallback(async (tripId) => {
        setLoadingDetails(true);
        try {
            const { data } = await api.get(`/api/trips/${tripId}?simplify=true`);
            setTripDetails(data);
        } catch (err) {
            setError('Error al cargar detalles del viaje');
        }
        setLoadingDetails(false);
    }, []);

    const handleTripClick = useCallback((trip) => {
        setSelectedTrip(trip);
        fetchTripDetails(trip.id);
    }, [fetchTripDetails]);

    const handleBack = useCallback(() => {
        setSelectedTrip(null);
        setTripDetails(null);
    }, []);

    const employeeName = useMemo(() => {
        return employees.find(e => e.id === selectedEmployee)?.name || 'Vendedor';
    }, [employees, selectedEmployee]);

    return (
        <div className="hist-container">
            {/* Mapa a fondo */}
            <div className="hist-map-section">
                {selectedTrip && tripDetails ? (
                    loadingDetails ? (
                        <div className="hist-loading-overlay">
                            <Loader size={40} className="spin" />
                            <p>Cargando ruta...</p>
                        </div>
                    ) : (
                        <MapView
                            view="history"
                            selectedEmployee={employees.find(e => e.id === selectedEmployee) || null}
                            selectedTrip={selectedTrip}
                            tripDetails={tripDetails}
                        />
                    )
                ) : (
                    <MapView
                        view="history"
                        selectedEmployee={employees.find(e => e.id === selectedEmployee) || null}
                        trips={trips}
                        stops={stops}
                    />
                )}
            </div>

            {/* Barra de filtros superior */}
            <div className="hist-top-bar">
                <div className="hist-filter-controls">
                    <div className="hist-select-group">
                        <label>Vendedor</label>
                        <select
                            value={selectedEmployee || ''}
                            onChange={(e) => setSelectedEmployee(parseInt(e.target.value))}
                        >
                            <option value="">Seleccionar...</option>
                            {employees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="hist-select-group">
                        <label>Desde</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>

                    <div className="hist-select-group">
                        <label>Hasta</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        />
                    </div>

                    <button className="hist-btn-refresh" onClick={fetchHistory} disabled={loading}>
                        {loading ? <Loader size={16} className="spin" /> : '🔄'}
                        Actualizar
                    </button>
                </div>

                {error && (
                    <div className="hist-error-banner">
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}
            </div>

            {/* Panel de datos a la derecha */}
            <div className={`hist-right-panel ${selectedTrip ? 'detail' : 'list'}`}>
                {selectedTrip ? (
                    // DETAIL VIEW
                    <div className="hist-detail-view">
                        <div className="hist-detail-header">
                            <button className="hist-btn-back" onClick={handleBack}>
                                <ArrowLeft size={18} />
                            </button>
                            <div>
                                <h2>{employeeName}</h2>
                                <p>{selectedTrip.trip_date} · {selectedTrip.start_time_formatted} a {selectedTrip.end_time_formatted}</p>
                            </div>
                        </div>

                        <div className="hist-detail-metrics">
                            <div className="metric-card">
                                <div className="metric-icon">📏</div>
                                <div>
                                    <div className="metric-label">Distancia</div>
                                    <div className="metric-value">{selectedTrip.distance_km} km</div>
                                </div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-icon">⏱️</div>
                                <div>
                                    <div className="metric-label">Duración</div>
                                    <div className="metric-value">{selectedTrip.duration_hours}h</div>
                                </div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-icon">📍</div>
                                <div>
                                    <div className="metric-label">Paradas</div>
                                    <div className="metric-value">{selectedTrip.stop_count}</div>
                                </div>
                            </div>
                        </div>

                        <div className="hist-stops-list">
                            <h3>Paradas ({tripDetails?.stops?.length || 0})</h3>
                            {tripDetails?.stops?.length > 0 ? (
                                <div className="stops-container">
                                    {tripDetails.stops.map((stop, idx) => (
                                        <div key={idx} className="stop-item">
                                            <div className="stop-number">{idx + 1}</div>
                                            <div className="stop-details">
                                                <div className="stop-times">
                                                    {formatTime(stop.start_time)} → {formatTime(stop.end_time)}
                                                </div>
                                                <div className="stop-duration">{formatDuration(stop.duration_seconds)}</div>
                                                <div className="stop-coords">
                                                    {stop.lat?.toFixed(5)}, {stop.lng?.toFixed(5)}
                                                </div>
                                            </div>
                                            <a
                                                href={`https://www.google.com/maps?q=${stop.lat},${stop.lng}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="stop-maps-btn"
                                            >
                                                🗺️
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="hist-empty">Sin paradas</div>
                            )}
                        </div>
                    </div>
                ) : (
                    // LIST VIEW
                    <div className="hist-list-view">
                        <div className="hist-list-tabs">
                            <button
                                className={`tab-btn ${activeTab === 'trips' ? 'active' : ''}`}
                                onClick={() => setActiveTab('trips')}
                            >
                                <TrendingUp size={16} />
                                Recorridos <span className="tab-count">{paginationInfo.trips.total}</span>
                            </button>
                            <button
                                className={`tab-btn ${activeTab === 'stops' ? 'active' : ''}`}
                                onClick={() => setActiveTab('stops')}
                            >
                                <MapPin size={16} />
                                Paradas <span className="tab-count">{paginationInfo.stops.total}</span>
                            </button>
                            <button
                                className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`}
                                onClick={() => setActiveTab('events')}
                            >
                                <AlertCircle size={16} />
                                Eventos <span className="tab-count">{paginationInfo.events.total}</span>
                            </button>
                        </div>

                        <div className="hist-list-content">
                            {loading && (
                                <div className="hist-loading-state">
                                    <Loader size={32} className="spin" />
                                    <p>Cargando...</p>
                                </div>
                            )}

                            {!loading && activeTab === 'trips' && (
                                <>
                                    {trips.length === 0 ? (
                                        <div className="hist-empty">📍 Sin recorridos</div>
                                    ) : (
                                        <div className="trips-list">
                                            {trips.map(trip => (
                                                <TripCard
                                                    key={trip.id}
                                                    trip={trip}
                                                    onClick={() => handleTripClick(trip)}
                                                    employee={employeeName}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {paginationInfo.trips.hasMore && (
                                        <button className="hist-btn-loadmore" onClick={loadMoreTrips}>
                                            Cargar más ({trips.length}/{paginationInfo.trips.total})
                                        </button>
                                    )}
                                </>
                            )}

                            {!loading && activeTab === 'stops' && (
                                <>
                                    {stops.length === 0 ? (
                                        <div className="hist-empty">📍 Sin paradas</div>
                                    ) : (
                                        <div className="stops-list">
                                            {stops.map((stop, idx) => (
                                                <StopRow key={idx} stop={stop} />
                                            ))}
                                        </div>
                                    )}
                                    {paginationInfo.stops.hasMore && (
                                        <button className="hist-btn-loadmore" onClick={loadMoreStops}>
                                            Cargar más ({stops.length}/{paginationInfo.stops.total})
                                        </button>
                                    )}
                                </>
                            )}

                            {!loading && activeTab === 'events' && (
                                <>
                                    {events.length === 0 ? (
                                        <div className="hist-empty">✨ Sin eventos</div>
                                    ) : (
                                        <div className="events-list">
                                            {events.map((event, idx) => (
                                                <EventRow key={idx} event={event} />
                                            ))}
                                        </div>
                                    )}
                                    {paginationInfo.events.hasMore && (
                                        <button className="hist-btn-loadmore" onClick={loadMoreEvents}>
                                            Cargar más ({events.length}/{paginationInfo.events.total})
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
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
                    padding: 12px 16px;
                    text-align: left;
                    font-size: 11px;
                    font-weight: 700;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                    white-space: nowrap;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }

                .hist-table td {
                    padding: 14px 16px;
                    border-top: 1px solid rgba(255,255,255,0.02);
                    color: #e2e8f0;
                    background: transparent;
                    line-height: 1.5;
                }

                .hist-table td strong {
                    color: #f1f5f9;
                    font-weight: 600;
                }

                .hist-table tr:hover td { 
                    background: rgba(255,255,255,0.04) !important;
                    transition: background 0.1s ease;
                }

                .hist-stop-num {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                    background: rgba(37,99,235,0.25);
                    color: #93c5fd;
                    border-radius: 50%;
                    font-size: 12px;
                    font-weight: 700;
                }

                .hist-duration {
                    display: inline-block;
                    padding: 4px 10px;
                    background: rgba(245,158,11,0.15);
                    color: #fcd34d;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                }

                .hist-coord {
                    display: inline-block;
                    padding: 4px 10px;
                    background: rgba(37,99,235,0.15);
                    color: #93c5fd;
                    border-radius: 6px;
                    font-size: 12px;
                    font-family: 'Monaco', 'Courier New', monospace;
                }

                .hist-view-btn {
                    padding: 6px 14px;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 7px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .hist-view-btn:hover { 
                    background: #1d4ed8;
                    transform: translateY(-1px);
                }

                .hist-load-more {
                    display: block;
                    margin: 20px auto;
                    padding: 10px 24px;
                    background: rgba(37,99,235,0.2);
                    color: #60a5fa;
                    border: 1px solid rgba(37,99,235,0.3);
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    transition: all 0.15s ease;
                }
                .hist-load-more:hover {
                    background: rgba(37,99,235,0.3);
                    border-color: rgba(37,99,235,0.5);
                    transform: translateY(-2px);
                }

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
                    .hist-table th,
                    .hist-table td { padding: 10px 12px; font-size: 12px; }
                }
            `}</style>
        </div>
    );
};

export default History;
