import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { Search, Calendar, Clock, MapPin, ChevronRight, ArrowLeft, Loader, AlertCircle, ChevronUp, ChevronDown, TrendingUp, X, Navigation } from 'lucide-react';
import api from '../services/api';
import MapView from '../components/MapView';

/* ── helpers ── */
const formatTime = (t) => {
    if (!t) return '--:--';
    const d = new Date(t);
    return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};
const formatDuration = (s) => {
    if (!s || s <= 0) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/* ── Trip card ── */
const TripCard = memo(({ trip, onClick }) => (
    <button className="hx-trip-card" onClick={onClick}>
        <div className="hx-trip-top">
            <span className="hx-trip-date">{trip.trip_date}</span>
            <span className="hx-trip-time"><Clock size={12} /> {trip.start_time_formatted} → {trip.end_time_formatted}</span>
        </div>
        <div className="hx-trip-stats">
            <div className="hx-stat"><span className="hx-stat-val">{trip.distance_km}</span><span className="hx-stat-lbl">km</span></div>
            <div className="hx-stat"><span className="hx-stat-val">{trip.duration_hours}</span><span className="hx-stat-lbl">horas</span></div>
            <div className="hx-stat"><span className="hx-stat-val">{trip.stop_count}</span><span className="hx-stat-lbl">paradas</span></div>
        </div>
        <div className="hx-trip-cta">Ver ruta <ChevronRight size={14} /></div>
    </button>
));
TripCard.displayName = 'TripCard';

/* ── Stop row ── */
const StopRow = memo(({ stop }) => (
    <div className="hx-stop-row">
        <div className="hx-stop-time-col">
            <span className="hx-stop-date-tag">{stop.stop_date}</span>
            <span className="hx-stop-time-tag">{stop.start_time_formatted}</span>
        </div>
        <div className="hx-stop-dur">{stop.duration_formatted}</div>
        <div className="hx-stop-loc">
            <MapPin size={12} />
            <code>{stop.latitude}, {stop.longitude}</code>
        </div>
    </div>
));
StopRow.displayName = 'StopRow';

/* ── Event row ── */
const EventRow = memo(({ event }) => (
    <div className="hx-event-row">
        <span className="hx-ev-date">{event.event_date}</span>
        <span className="hx-ev-time">{event.event_time}</span>
        <span className={`hx-ev-badge ${event.event_type === 'GPS_OFF' ? 'off' : 'on'}`}>
            {event.event_type === 'GPS_OFF' ? '⛔ OFF' : '✅ ON'}
        </span>
        <span className="hx-ev-reason">{event.state}</span>
        {event.duration_off_formatted && <span className="hx-ev-dur">{event.duration_off_formatted}</span>}
    </div>
));
EventRow.displayName = 'EventRow';

/* ══════════════════════════════════════════ */
/*  MAIN COMPONENT                            */
/* ══════════════════════════════════════════ */
const History = ({ user }) => {
    /* ── state ── */
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const searchRef = useRef(null);

    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() + 1);
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

    /* drawer: 'collapsed' | 'half' | 'full' */
    const [drawerState, setDrawerState] = useState('half');

    /* ── close search on outside click ── */
    useEffect(() => {
        const handler = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    /* ── fetch employees ── */
    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const { data } = await api.get('/api/trips/employees');
                setEmployees(data);
                if (data.length > 0) setSelectedEmployee(data[0].id);
            } catch { setError('Error al cargar vendedores'); }
        };
        fetchEmployees();
    }, []);

    /* ── fetch history ── */
    const fetchHistory = useCallback(async () => {
        setLoading(true); setError('');
        setTripsPage(1); setStopsPage(1); setEventsPage(1);
        if (!selectedEmployee) { setLoading(false); return; }
        const tzOffset = dayjs().format('Z');
        try {
            const [tripsRes, stopsRes, eventsRes] = await Promise.all([
                api.get(`/api/trips/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=1&limit=${itemsPerPage}&tzOffset=${tzOffset}`),
                api.get(`/api/trips/stops/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=1&limit=${itemsPerPage}&tzOffset=${tzOffset}`),
                api.get(`/api/trips/events/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=1&limit=${itemsPerPage}&tzOffset=${tzOffset}`)
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
            setTrips([]); setStops([]); setEvents([]);
        }
        setLoading(false);
    }, [selectedEmployee, startDate, endDate]);

    useEffect(() => { if (selectedEmployee) fetchHistory(); }, [selectedEmployee, startDate, endDate, fetchHistory]);

    /* ── pagination loaders ── */
    const loadMoreTrips = useCallback(async () => {
        if (loading) return;
        const nextPage = tripsPage + 1;
        const tzOffset = dayjs().format('Z');
        try {
            const { data } = await api.get(`/api/trips/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=${nextPage}&limit=${itemsPerPage}&tzOffset=${tzOffset}`);
            setTrips(prev => [...prev, ...(data.trips || [])]);
            setTripsPage(nextPage);
            setPaginationInfo(prev => ({ ...prev, trips: { total: data.total, hasMore: data.hasMore } }));
        } catch { setError('Error al cargar más viajes'); }
    }, [selectedEmployee, startDate, endDate, tripsPage, loading]);

    const loadMoreStops = useCallback(async () => {
        if (loading) return;
        const nextPage = stopsPage + 1;
        const tzOffset = dayjs().format('Z');
        try {
            const { data } = await api.get(`/api/trips/stops/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=${nextPage}&limit=${itemsPerPage}&tzOffset=${tzOffset}`);
            setStops(prev => [...prev, ...(data.stops || [])]);
            setStopsPage(nextPage);
            setPaginationInfo(prev => ({ ...prev, stops: { total: data.total, hasMore: data.hasMore } }));
        } catch { setError('Error al cargar más paradas'); }
    }, [selectedEmployee, startDate, endDate, stopsPage, loading]);

    const loadMoreEvents = useCallback(async () => {
        if (loading) return;
        const nextPage = eventsPage + 1;
        const tzOffset = dayjs().format('Z');
        try {
            const { data } = await api.get(`/api/trips/events/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}&page=${nextPage}&limit=${itemsPerPage}&tzOffset=${tzOffset}`);
            setEvents(prev => [...prev, ...(data.events || [])]);
            setEventsPage(nextPage);
            setPaginationInfo(prev => ({ ...prev, events: { total: data.total, hasMore: data.hasMore } }));
        } catch { setError('Error al cargar más eventos'); }
    }, [selectedEmployee, startDate, endDate, eventsPage, loading]);

    /* ── trip detail ── */
    const fetchTripDetails = useCallback(async (tripId) => {
        setLoadingDetails(true);
        try {
            const { data } = await api.get(`/api/trips/${tripId}?simplify=true`);
            setTripDetails(data);
        } catch { setError('Error al cargar detalles del viaje'); }
        setLoadingDetails(false);
    }, []);

    const handleTripClick = useCallback((trip) => {
        setSelectedTrip(trip);
        fetchTripDetails(trip.id);
        setDrawerState('half');
    }, [fetchTripDetails]);

    const handleBack = useCallback(() => {
        setSelectedTrip(null);
        setTripDetails(null);
    }, []);

    /* ── derived ── */
    const employeeName = useMemo(() => employees.find(e => e.id === selectedEmployee)?.name || 'Vendedor', [employees, selectedEmployee]);

    const filteredEmployees = useMemo(() => {
        if (!searchQuery.trim()) return employees;
        const q = searchQuery.toLowerCase();
        return employees.filter(e => e.name.toLowerCase().includes(q));
    }, [employees, searchQuery]);

    const selectEmployee = (emp) => {
        setSelectedEmployee(emp.id);
        setSearchQuery('');
        setSearchOpen(false);
    };

    const toggleDrawer = () => {
        setDrawerState(prev => prev === 'collapsed' ? 'half' : prev === 'half' ? 'full' : 'collapsed');
    };

    /* ══════════════════ RENDER ══════════════════ */
    return (
        <div className="hx-root">
            {/* ─── FULL-SCREEN MAP ─── */}
            <div className="hx-map">
                {selectedTrip && tripDetails ? (
                    loadingDetails ? (
                        <div className="hx-map-loader"><Loader size={36} className="spin" /><p>Cargando ruta…</p></div>
                    ) : (
                        <MapView view="history" selectedEmployee={employees.find(e => e.id === selectedEmployee) || null} selectedTrip={selectedTrip} tripDetails={tripDetails} />
                    )
                ) : (
                    <MapView view="history" selectedEmployee={employees.find(e => e.id === selectedEmployee) || null} trips={trips} stops={stops} />
                )}
            </div>

            {/* ─── FLOATING SEARCH BAR ─── */}
            <div className="hx-search-wrap" ref={searchRef}>
                <div className="hx-search-bar">
                    <Search size={18} className="hx-search-icon" />
                    {selectedEmployee && !searchOpen ? (
                        <button className="hx-vendor-chip" onClick={() => setSearchOpen(true)}>
                            <Navigation size={13} />
                            <span>{employeeName}</span>
                            <X size={14} className="hx-chip-x" onClick={(e) => { e.stopPropagation(); setSelectedEmployee(null); setSearchOpen(true); }} />
                        </button>
                    ) : (
                        <input
                            className="hx-search-input"
                            type="text"
                            placeholder="Buscar vendedor…"
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                            onFocus={() => setSearchOpen(true)}
                            autoComplete="off"
                        />
                    )}
                </div>

                {searchOpen && (
                    <div className="hx-search-dropdown">
                        {filteredEmployees.length === 0 ? (
                            <div className="hx-search-empty">No se encontraron vendedores</div>
                        ) : (
                            filteredEmployees.map(emp => (
                                <button
                                    key={emp.id}
                                    className={`hx-search-item ${emp.id === selectedEmployee ? 'active' : ''}`}
                                    onClick={() => selectEmployee(emp)}
                                >
                                    <div className="hx-search-avatar">{emp.name.charAt(0).toUpperCase()}</div>
                                    <span>{emp.name}</span>
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* ─── FLOATING DATE CONTROLS ─── */}
            <div className="hx-date-float">
                <div className="hx-date-field">
                    <Calendar size={13} />
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <span className="hx-date-sep">→</span>
                <div className="hx-date-field">
                    <Calendar size={13} />
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
            </div>

            {/* ─── ERROR TOAST ─── */}
            {error && (
                <div className="hx-toast-error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                    <button onClick={() => setError('')}><X size={14} /></button>
                </div>
            )}

            {/* ─── BOTTOM DRAWER ─── */}
            <div className={`hx-drawer hx-drawer--${drawerState}`}>
                {/* Handle */}
                <button className="hx-drawer-handle" onClick={toggleDrawer}>
                    <div className="hx-handle-pill" />
                    {drawerState === 'collapsed' && (
                        <span className="hx-handle-hint">
                            <ChevronUp size={16} />
                            {selectedTrip ? `${employeeName} — ${selectedTrip.trip_date}` : `${employeeName} — Historial de ruta`}
                        </span>
                    )}
                </button>

                {/* Drawer body */}
                <div className="hx-drawer-body">
                    {selectedTrip ? (
                        /* ─── DETAIL VIEW ─── */
                        <div className="hx-detail">
                            <div className="hx-detail-head">
                                <button className="hx-back-btn" onClick={handleBack}><ArrowLeft size={18} /></button>
                                <div>
                                    <h2 className="hx-detail-name">{employeeName}</h2>
                                    <p className="hx-detail-sub">{selectedTrip.trip_date} · {selectedTrip.start_time_formatted} a {selectedTrip.end_time_formatted}</p>
                                </div>
                            </div>

                            <div className="hx-detail-metrics">
                                <div className="hx-metric-pill"><span className="hx-m-icon">📏</span><div><div className="hx-m-val">{selectedTrip.distance_km} km</div><div className="hx-m-lbl">Distancia</div></div></div>
                                <div className="hx-metric-pill"><span className="hx-m-icon">⏱️</span><div><div className="hx-m-val">{selectedTrip.duration_hours}h</div><div className="hx-m-lbl">Duración</div></div></div>
                                <div className="hx-metric-pill"><span className="hx-m-icon">📍</span><div><div className="hx-m-val">{selectedTrip.stop_count}</div><div className="hx-m-lbl">Paradas</div></div></div>
                            </div>

                            <h3 className="hx-section-title">Paradas ({tripDetails?.stops?.length || 0})</h3>
                            {tripDetails?.stops?.length > 0 ? (
                                <div className="hx-stops-detail-list">
                                    {tripDetails.stops.map((stop, idx) => (
                                        <div key={idx} className="hx-stop-detail-item">
                                            <div className="hx-stop-num">{idx + 1}</div>
                                            <div className="hx-stop-info">
                                                <div className="hx-stop-times">{formatTime(stop.start_time)} → {formatTime(stop.end_time)}</div>
                                                <div className="hx-stop-dur-tag">{formatDuration(stop.duration_seconds)}</div>
                                                <div className="hx-stop-coords">{stop.lat?.toFixed(5)}, {stop.lng?.toFixed(5)}</div>
                                            </div>
                                            <a href={`https://www.google.com/maps?q=${stop.lat},${stop.lng}`} target="_blank" rel="noopener noreferrer" className="hx-maps-link" title="Abrir en Google Maps">🗺️</a>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="hx-empty-msg">Sin paradas registradas</div>
                            )}
                        </div>
                    ) : (
                        /* ─── LIST VIEW ─── */
                        <>
                            {/* Tabs */}
                            <div className="hx-tabs">
                                <button className={`hx-tab ${activeTab === 'trips' ? 'active' : ''}`} onClick={() => setActiveTab('trips')}>
                                    <TrendingUp size={14} /> Recorridos <span className="hx-tab-count">{paginationInfo.trips.total}</span>
                                </button>
                                <button className={`hx-tab ${activeTab === 'stops' ? 'active' : ''}`} onClick={() => setActiveTab('stops')}>
                                    <MapPin size={14} /> Paradas <span className="hx-tab-count">{paginationInfo.stops.total}</span>
                                </button>
                                <button className={`hx-tab ${activeTab === 'events' ? 'active' : ''}`} onClick={() => setActiveTab('events')}>
                                    <AlertCircle size={14} /> Eventos <span className="hx-tab-count">{paginationInfo.events.total}</span>
                                </button>
                            </div>

                            {/* Content */}
                            <div className="hx-list-content">
                                {loading && <div className="hx-loading"><Loader size={28} className="spin" /><span>Cargando…</span></div>}

                                {!loading && activeTab === 'trips' && (
                                    <>
                                        {trips.length === 0 ? <div className="hx-empty-msg">📍 Sin recorridos en este rango</div> : (
                                            <div className="hx-trips-grid">
                                                {trips.map(trip => <TripCard key={trip.id} trip={trip} onClick={() => handleTripClick(trip)} />)}
                                            </div>
                                        )}
                                        {paginationInfo.trips.hasMore && <button className="hx-load-more" onClick={loadMoreTrips}>Cargar más ({trips.length}/{paginationInfo.trips.total})</button>}
                                    </>
                                )}

                                {!loading && activeTab === 'stops' && (
                                    <>
                                        {stops.length === 0 ? <div className="hx-empty-msg">📍 Sin paradas</div> : (
                                            <div className="hx-stops-list">{stops.map((stop, idx) => <StopRow key={idx} stop={stop} />)}</div>
                                        )}
                                        {paginationInfo.stops.hasMore && <button className="hx-load-more" onClick={loadMoreStops}>Cargar más ({stops.length}/{paginationInfo.stops.total})</button>}
                                    </>
                                )}

                                {!loading && activeTab === 'events' && (
                                    <>
                                        {events.length === 0 ? <div className="hx-empty-msg">✨ Sin eventos</div> : (
                                            <div className="hx-events-list">{events.map((event, idx) => <EventRow key={idx} event={event} />)}</div>
                                        )}
                                        {paginationInfo.events.hasMore && <button className="hx-load-more" onClick={loadMoreEvents}>Cargar más ({events.length}/{paginationInfo.events.total})</button>}
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ═══════════════════════ STYLES ═══════════════════════ */}
            <style>{`
                /* ─── ROOT ─── */
                .hx-root {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    background: #0f172a;
                }

                /* ─── MAP ─── */
                .hx-map {
                    position: absolute;
                    inset: 0;
                    z-index: 0;
                }
                .hx-map-loader {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    background: #0f172a;
                    color: #94a3b8;
                }

                /* ─── FLOATING SEARCH ─── */
                .hx-search-wrap {
                    position: absolute;
                    top: 16px;
                    left: 16px;
                    z-index: 100;
                    width: 320px;
                    max-width: calc(100vw - 200px);
                }
                .hx-search-bar {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 16px;
                    background: rgba(15, 23, 42, 0.82);
                    backdrop-filter: blur(24px) saturate(180%);
                    -webkit-backdrop-filter: blur(24px) saturate(180%);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 16px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                    transition: border-color 0.2s;
                }
                .hx-search-bar:focus-within { border-color: #3b82f6; }
                .hx-search-icon { color: #64748b; flex-shrink: 0; }
                .hx-search-input {
                    flex: 1;
                    background: none;
                    border: none;
                    outline: none;
                    color: #f1f5f9;
                    font-size: 14px;
                    font-family: inherit;
                }
                .hx-search-input::placeholder { color: #475569; }

                /* vendor chip */
                .hx-vendor-chip {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 12px;
                    background: rgba(59,130,246,0.2);
                    border: 1px solid rgba(59,130,246,0.35);
                    border-radius: 999px;
                    color: #93c5fd;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    font-family: inherit;
                    white-space: nowrap;
                    transition: all 0.15s;
                }
                .hx-vendor-chip:hover { background: rgba(59,130,246,0.3); }
                .hx-chip-x {
                    opacity: 0.6;
                    transition: opacity 0.15s;
                }
                .hx-chip-x:hover { opacity: 1; }

                /* dropdown */
                .hx-search-dropdown {
                    margin-top: 6px;
                    background: rgba(15, 23, 42, 0.92);
                    backdrop-filter: blur(24px) saturate(180%);
                    -webkit-backdrop-filter: blur(24px) saturate(180%);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 16px;
                    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
                    max-height: 280px;
                    overflow-y: auto;
                    padding: 6px;
                    animation: hxFadeIn 0.15s ease;
                }
                .hx-search-empty {
                    padding: 20px;
                    text-align: center;
                    color: #475569;
                    font-size: 13px;
                }
                .hx-search-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    padding: 10px 14px;
                    background: transparent;
                    border: none;
                    border-radius: 12px;
                    color: #e2e8f0;
                    font-size: 14px;
                    cursor: pointer;
                    font-family: inherit;
                    text-align: left;
                    transition: background 0.12s;
                }
                .hx-search-item:hover { background: rgba(255,255,255,0.06); }
                .hx-search-item.active { background: rgba(59,130,246,0.15); color: #93c5fd; }
                .hx-search-avatar {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                    color: white;
                    font-size: 14px;
                    font-weight: 700;
                    flex-shrink: 0;
                }

                /* ─── FLOATING DATE ─── */
                .hx-date-float {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    z-index: 100;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 14px;
                    background: rgba(15, 23, 42, 0.82);
                    backdrop-filter: blur(24px) saturate(180%);
                    -webkit-backdrop-filter: blur(24px) saturate(180%);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 14px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                }
                .hx-date-field {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: #94a3b8;
                }
                .hx-date-field input[type="date"] {
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.08);
                    color: #e2e8f0;
                    padding: 6px 10px;
                    border-radius: 8px;
                    font-size: 12px;
                    font-family: inherit;
                    outline: none;
                    transition: border-color 0.2s;
                }
                .hx-date-field input[type="date"]:focus { border-color: #3b82f6; }
                .hx-date-field input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
                .hx-date-sep { color: #475569; font-size: 14px; font-weight: 600; }

                /* ─── ERROR TOAST ─── */
                .hx-toast-error {
                    position: absolute;
                    top: 72px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 200;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 18px;
                    background: rgba(220, 38, 38, 0.85);
                    backdrop-filter: blur(12px);
                    border-radius: 12px;
                    color: white;
                    font-size: 13px;
                    font-weight: 500;
                    box-shadow: 0 8px 24px rgba(220,38,38,0.3);
                    animation: hxSlideDown 0.25s ease;
                }
                .hx-toast-error button {
                    background: none;
                    border: none;
                    color: rgba(255,255,255,0.7);
                    cursor: pointer;
                    padding: 2px;
                }

                /* ─── DRAWER ─── */
                .hx-drawer {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    z-index: 80;
                    background: rgba(15, 23, 42, 0.88);
                    backdrop-filter: blur(28px) saturate(180%);
                    -webkit-backdrop-filter: blur(28px) saturate(180%);
                    border-top: 1px solid rgba(255,255,255,0.08);
                    border-radius: 24px 24px 0 0;
                    box-shadow: 0 -12px 48px rgba(0,0,0,0.45);
                    display: flex;
                    flex-direction: column;
                    transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                    will-change: height;
                }
                .hx-drawer--collapsed { height: 56px; }
                .hx-drawer--half { height: 45%; }
                .hx-drawer--full { height: 85%; }

                .hx-drawer-handle {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    padding: 12px 24px;
                    background: transparent;
                    border: none;
                    color: #94a3b8;
                    cursor: pointer;
                    min-height: 44px;
                    width: 100%;
                    font-family: inherit;
                }
                .hx-handle-pill {
                    width: 36px;
                    height: 4px;
                    background: rgba(255,255,255,0.2);
                    border-radius: 2px;
                }
                .hx-handle-hint {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                }

                .hx-drawer-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0 24px 24px;
                }
                .hx-drawer--collapsed .hx-drawer-body { display: none; }

                /* scrollbar */
                .hx-drawer-body::-webkit-scrollbar { width: 4px; }
                .hx-drawer-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }

                /* ─── TABS ─── */
                .hx-tabs {
                    display: flex;
                    gap: 4px;
                    padding: 4px;
                    background: rgba(255,255,255,0.04);
                    border-radius: 12px;
                    margin-bottom: 16px;
                    width: fit-content;
                }
                .hx-tab {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: transparent;
                    border: none;
                    border-radius: 9px;
                    color: #64748b;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    font-family: inherit;
                    transition: all 0.15s;
                    white-space: nowrap;
                }
                .hx-tab:hover { color: #e2e8f0; background: rgba(255,255,255,0.04); }
                .hx-tab.active {
                    background: linear-gradient(135deg, #2563eb, #3b82f6);
                    color: white;
                    box-shadow: 0 2px 8px rgba(37,99,235,0.35);
                }
                .hx-tab-count {
                    padding: 1px 7px;
                    background: rgba(255,255,255,0.12);
                    border-radius: 999px;
                    font-size: 11px;
                }
                .hx-tab.active .hx-tab-count { background: rgba(255,255,255,0.2); }

                /* ─── LOADING / EMPTY ─── */
                .hx-loading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    padding: 40px;
                    color: #64748b;
                    font-size: 14px;
                }
                .hx-empty-msg {
                    text-align: center;
                    color: #475569;
                    font-size: 14px;
                    padding: 40px 16px;
                }

                /* ─── TRIPS GRID ─── */
                .hx-trips-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
                    gap: 10px;
                }
                .hx-trip-card {
                    background: rgba(255,255,255,0.04);
                    border: 1px solid rgba(255,255,255,0.07);
                    border-radius: 14px;
                    padding: 14px 16px;
                    cursor: pointer;
                    text-align: left;
                    font-family: inherit;
                    transition: all 0.18s ease;
                    width: 100%;
                }
                .hx-trip-card:hover {
                    background: rgba(59,130,246,0.08);
                    border-color: rgba(59,130,246,0.3);
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(59,130,246,0.15);
                }
                .hx-trip-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid rgba(255,255,255,0.06);
                }
                .hx-trip-date { font-size: 14px; font-weight: 700; color: #f1f5f9; }
                .hx-trip-time {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 11px;
                    color: #64748b;
                }
                .hx-trip-stats {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 8px;
                    margin-bottom: 12px;
                }
                .hx-stat { display: flex; flex-direction: column; gap: 2px; }
                .hx-stat-val { font-size: 16px; font-weight: 800; color: #e2e8f0; }
                .hx-stat-lbl { font-size: 10px; color: #475569; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; }
                .hx-trip-cta {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    font-size: 12px;
                    color: #60a5fa;
                    font-weight: 700;
                    padding-top: 10px;
                    border-top: 1px solid rgba(255,255,255,0.06);
                }

                /* ─── STOPS (list tab) ─── */
                .hx-stops-list { display: flex; flex-direction: column; gap: 6px; }
                .hx-stop-row {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    padding: 10px 14px;
                    background: rgba(255,255,255,0.03);
                    border-radius: 10px;
                    transition: background 0.12s;
                }
                .hx-stop-row:hover { background: rgba(255,255,255,0.06); }
                .hx-stop-time-col { display: flex; flex-direction: column; gap: 2px; min-width: 80px; }
                .hx-stop-date-tag { font-size: 11px; color: #64748b; font-weight: 600; }
                .hx-stop-time-tag { font-size: 13px; color: #e2e8f0; font-weight: 700; }
                .hx-stop-dur {
                    padding: 3px 10px;
                    background: rgba(245,158,11,0.15);
                    color: #fcd34d;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                }
                .hx-stop-loc {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: #64748b;
                    font-size: 12px;
                }
                .hx-stop-loc code {
                    background: rgba(59,130,246,0.12);
                    color: #93c5fd;
                    padding: 2px 8px;
                    border-radius: 6px;
                    font-size: 11px;
                }

                /* ─── EVENTS ─── */
                .hx-events-list { display: flex; flex-direction: column; gap: 6px; }
                .hx-event-row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 14px;
                    background: rgba(255,255,255,0.03);
                    border-radius: 10px;
                    font-size: 13px;
                    transition: background 0.12s;
                }
                .hx-event-row:hover { background: rgba(255,255,255,0.06); }
                .hx-ev-date { color: #94a3b8; font-weight: 600; min-width: 80px; font-size: 12px; }
                .hx-ev-time { color: #e2e8f0; font-weight: 700; min-width: 55px; }
                .hx-ev-badge {
                    padding: 3px 10px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 700;
                    white-space: nowrap;
                }
                .hx-ev-badge.off { background: rgba(239,68,68,0.15); color: #fca5a5; }
                .hx-ev-badge.on { background: rgba(34,197,94,0.15); color: #86efac; }
                .hx-ev-reason { color: #94a3b8; font-size: 12px; flex: 1; }
                .hx-ev-dur { color: #fcd34d; font-size: 12px; font-weight: 600; }

                /* ─── LOAD MORE ─── */
                .hx-load-more {
                    display: block;
                    margin: 16px auto 0;
                    padding: 10px 24px;
                    background: rgba(59,130,246,0.15);
                    color: #60a5fa;
                    border: 1px solid rgba(59,130,246,0.25);
                    border-radius: 10px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    font-family: inherit;
                    transition: all 0.15s;
                }
                .hx-load-more:hover {
                    background: rgba(59,130,246,0.25);
                    border-color: rgba(59,130,246,0.45);
                    transform: translateY(-1px);
                }

                /* ─── DETAIL VIEW ─── */
                .hx-detail-head {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    margin-bottom: 16px;
                }
                .hx-back-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 38px;
                    height: 38px;
                    background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 12px;
                    color: #e2e8f0;
                    cursor: pointer;
                    transition: all 0.15s;
                    flex-shrink: 0;
                }
                .hx-back-btn:hover { background: rgba(255,255,255,0.1); border-color: #3b82f6; }
                .hx-detail-name { font-size: 16px; font-weight: 700; color: #f1f5f9; margin: 0; }
                .hx-detail-sub { font-size: 12px; color: #64748b; margin: 2px 0 0; }

                .hx-detail-metrics {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                    margin-bottom: 20px;
                }
                .hx-metric-pill {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 12px 14px;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 12px;
                }
                .hx-m-icon { font-size: 20px; }
                .hx-m-val { font-size: 16px; font-weight: 800; color: #f1f5f9; }
                .hx-m-lbl { font-size: 10px; color: #475569; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; }

                .hx-section-title {
                    font-size: 13px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    margin-bottom: 12px;
                }

                .hx-stops-detail-list { display: flex; flex-direction: column; gap: 8px; }
                .hx-stop-detail-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 14px;
                    background: rgba(255,255,255,0.03);
                    border-radius: 10px;
                    transition: background 0.12s;
                }
                .hx-stop-detail-item:hover { background: rgba(255,255,255,0.06); }
                .hx-stop-num {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 28px;
                    height: 28px;
                    background: rgba(59,130,246,0.2);
                    color: #93c5fd;
                    border-radius: 50%;
                    font-size: 12px;
                    font-weight: 700;
                    flex-shrink: 0;
                }
                .hx-stop-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
                .hx-stop-times { font-size: 13px; color: #e2e8f0; font-weight: 600; }
                .hx-stop-dur-tag {
                    font-size: 11px;
                    color: #fcd34d;
                    font-weight: 600;
                }
                .hx-stop-coords { font-size: 11px; color: #64748b; font-family: 'Monaco', 'Courier New', monospace; }
                .hx-maps-link {
                    font-size: 18px;
                    text-decoration: none;
                    opacity: 0.6;
                    transition: opacity 0.15s;
                    flex-shrink: 0;
                }
                .hx-maps-link:hover { opacity: 1; }

                /* ─── ANIMATIONS ─── */
                @keyframes hxFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes hxSlideDown { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

                /* ─── MOBILE ─── */
                @media (max-width: 640px) {
                    .hx-search-wrap { width: calc(100vw - 32px); max-width: none; }
                    .hx-date-float { 
                        top: auto;
                        bottom: calc(45% + 8px);
                        right: 12px;
                        padding: 6px 10px;
                        flex-direction: column;
                        gap: 4px;
                    }
                    .hx-date-sep { display: none; }
                    .hx-drawer--half { height: 50%; }
                    .hx-drawer--full { height: 90%; }
                    .hx-trips-grid { grid-template-columns: 1fr; }
                    .hx-detail-metrics { grid-template-columns: 1fr; }
                    .hx-drawer-body { padding: 0 14px 14px; }
                }
            `}</style>
        </div>
    );
};

export default History;
