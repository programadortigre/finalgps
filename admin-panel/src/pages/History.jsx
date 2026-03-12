import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Users, ChevronRight, ArrowLeft, Loader, AlertCircle, CalendarDays } from 'lucide-react';
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
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    
    const [trips, setTrips] = useState([]);
    const [stops, setStops] = useState([]);
    const [activeTab, setActiveTab] = useState('trips'); // 'trips' | 'stops'
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedTrip, setSelectedTrip] = useState(null);
    const [tripDetails, setTripDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    // Cargar lista de empleados
    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const { data } = await api.get('/api/trips/employees');
                setEmployees(data);
                if (data.length > 0) setSelectedEmployee(data[0].id);
            } catch (err) {
                console.error('Error fetching employees:', err);
                setError('Error al cargar vendedores');
            }
        };
        fetchEmployees();
    }, []);

    // Cargar historial cuando se actualizan filtros
    useEffect(() => {
        if (!selectedEmployee) return;
        fetchHistory();
    }, [selectedEmployee, startDate, endDate]);

    const fetchHistory = async () => {
        setLoading(true);
        setError('');
        try {
            const [tripsRes, stopsRes] = await Promise.all([
                api.get(`/api/trips/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}`),
                api.get(`/api/trips/stops/history/${selectedEmployee}?startDate=${startDate}&endDate=${endDate}`)
            ]);
            setTrips(tripsRes.data.trips || []);
            setStops(stopsRes.data.stops || []);
        } catch (err) {
            setError('Error al cargar historial: ' + (err.response?.data?.error || err.message));
            setTrips([]);
            setStops([]);
        }
        setLoading(false);
    };

    const fetchTripDetails = async (tripId) => {
        setLoadingDetails(true);
        try {
            const { data } = await api.get(`/api/trips/${tripId}?simplify=true`);
            setTripDetails(data);
        } catch (err) {
            setError('Error al cargar detalles del viaje');
            console.error(err);
        }
        setLoadingDetails(false);
    };

    const handleTripClick = (trip) => {
        setSelectedTrip(trip);
        fetchTripDetails(trip.id);
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('es-PE');
    };

    const formatDuration = (seconds) => {
        if (!seconds) return '-';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins > 60) {
            const hours = Math.floor(mins / 60);
            const restMins = mins % 60;
            return `${hours}h ${restMins}m`;
        }
        return `${mins}m ${secs}s`;
    };

    // Vista de detalles del viaje
    if (selectedTrip && tripDetails) {
        const selectedEmployeeName = employees.find(e => e.id === selectedEmployee)?.name || 'Vendedor';
        
        return (
            <div className="history-page">
                <button className="btn-back" onClick={() => setSelectedTrip(null)}>
                    <ArrowLeft size={18} /> Volver al historial
                </button>

                <div className="trip-detail-header">
                    <div>
                        <h2>Detalles del Viaje</h2>
                        <p className="trip-info">
                            {selectedEmployeeName} • {formatDate(selectedTrip.start_time)} • {formatTime(selectedTrip.start_time)}
                        </p>
                    </div>
                    <div className="trip-stats">
                        <div className="stat-card">
                            <span className="stat-label">Distancia</span>
                            <span className="stat-value">{(selectedTrip.distance_meters / 1000).toFixed(2)} km</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-label">Duración</span>
                            <span className="stat-value">{selectedTrip.duration_hours} h</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-label">Paradas</span>
                            <span className="stat-value">{selectedTrip.stop_count}</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-label">Puntos GPS</span>
                            <span className="stat-value">{selectedTrip.point_count}</span>
                        </div>
                    </div>
                </div>

                {loadingDetails ? (
                    <div className="loading-state">
                        <Loader className="spin" size={32} /> Cargando mapa...
                    </div>
                ) : (
                    <div className="trip-map-container">
                        <MapView 
                            points={tripDetails.points}
                            stops={tripDetails.stops}
                            selectedTrip={tripDetails.trip}
                        />
                    </div>
                )}

                {tripDetails.stops && tripDetails.stops.length > 0 && (
                    <div className="stops-list-detail">
                        <h3>🛑 Paradas en este viaje ({tripDetails.stops.length})</h3>
                        <table className="stops-table">
                            <thead>
                                <tr>
                                    <th>Hora de inicio</th>
                                    <th>Hora de fin</th>
                                    <th>Duración</th>
                                    <th>Ubicación</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tripDetails.stops.map((stop, idx) => (
                                    <tr key={idx}>
                                        <td>{formatTime(stop.start_time)}</td>
                                        <td>{formatTime(stop.end_time)}</td>
                                        <td>{formatDuration(stop.duration_seconds)}</td>
                                        <td>
                                            <span className="coord-badge">
                                                {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    }

    // Vista principal de historial
    return (
        <div className="history-page">
            <header className="page-header">
                <div>
                    <h2><CalendarDays size={22} /> Historial de Actividades</h2>
                    <p>Consulta paradas y recorridos de tus vendedores</p>
                </div>
            </header>

            {/* Filtros */}
            <div className="filters-section">
                <div className="filter-group">
                    <label>Vendedor</label>
                    <select 
                        value={selectedEmployee || ''} 
                        onChange={(e) => setSelectedEmployee(parseInt(e.target.value))}
                        className="filter-select"
                    >
                        <option value="">Seleccionar vendedor...</option>
                        {employees.map(emp => (
                            <option key={emp.id} value={emp.id}>{emp.name}</option>
                        ))}
                    </select>
                </div>

                <div className="filter-group">
                    <label>Desde</label>
                    <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="filter-input"
                    />
                </div>

                <div className="filter-group">
                    <label>Hasta</label>
                    <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="filter-input"
                    />
                </div>
            </div>

            {error && (
                <div className="error-box">
                    <AlertCircle size={18} /> {error}
                </div>
            )}

            {/* Tabs */}
            <div className="tabs-container">
                <button 
                    className={`tab ${activeTab === 'trips' ? 'active' : ''}`}
                    onClick={() => setActiveTab('trips')}
                >
                    <Clock size={18} /> Recorridos ({trips.length})
                </button>
                <button 
                    className={`tab ${activeTab === 'stops' ? 'active' : ''}`}
                    onClick={() => setActiveTab('stops')}
                >
                    <MapPin size={18} /> Paradas ({stops.length})
                </button>
            </div>

            {/* Contenido */}
            {loading ? (
                <div className="loading-state">
                    <Loader className="spin" size={32} /> Cargando historial...
                </div>
            ) : activeTab === 'trips' ? (
                <div className="trips-grid">
                    {trips.length === 0 ? (
                        <div className="empty-state">
                            <Clock size={48} /> No hay recorridos en este período
                        </div>
                    ) : (
                        trips.map(trip => (
                            <button
                                key={trip.id}
                                className="trip-card"
                                onClick={() => handleTripClick(trip)}
                            >
                                <div className="trip-card-header">
                                    <div className="trip-date">
                                        {formatDate(trip.start_time)}
                                    </div>
                                    <div className="trip-time">
                                        {formatTime(trip.start_time)} - {formatTime(trip.end_time)}
                                    </div>
                                </div>
                                <div className="trip-card-body">
                                    <div className="stat">
                                        <span className="label">Distancia</span>
                                        <span className="value">{(trip.distance_meters / 1000).toFixed(2)} km</span>
                                    </div>
                                    <div className="stat">
                                        <span className="label">Duración</span>
                                        <span className="value">{trip.duration_hours} h</span>
                                    </div>
                                    <div className="stat">
                                        <span className="label">Paradas</span>
                                        <span className="value">{trip.stop_count}</span>
                                    </div>
                                </div>
                                <div className="trip-card-footer">
                                    <span className="view-btn">Ver detalles <ChevronRight size={16} /></span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            ) : (
                <div className="stops-container">
                    {stops.length === 0 ? (
                        <div className="empty-state">
                            <MapPin size={48} /> No hay paradas en este período
                        </div>
                    ) : (
                        <div className="stops-table-wrapper">
                            <table className="stops-table">
                                <thead>
                                    <tr>
                                        <th>Fecha</th>
                                        <th>Hora de inicio</th>
                                        <th>Hora de fin</th>
                                        <th>Duración</th>
                                        <th>Ubicación</th>
                                        <th>Viaje</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stops.map((stop, idx) => (
                                        <tr key={idx}>
                                            <td>{formatDate(stop.start_time)}</td>
                                            <td>{formatTime(stop.start_time)}</td>
                                            <td>{formatTime(stop.end_time)}</td>
                                            <td>{formatDuration(stop.duration_seconds)}</td>
                                            <td>
                                                <span className="coord-badge">
                                                    {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
                                                </span>
                                            </td>
                                            <td>
                                                <button 
                                                    className="btn-view-trip"
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
                    )}
                </div>
            )}

            <style>{`
                .history-page {
                    padding: 24px;
                    height: 100%;
                    overflow-y: auto;
                    background: #f8fafc;
                }

                .btn-back {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 16px;
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    cursor: pointer;
                    color: #2563eb;
                    font-weight: 600;
                    margin-bottom: 20px;
                    transition: all 0.2s;
                }

                .btn-back:hover {
                    background: #f1f5f9;
                }

                .page-header {
                    margin-bottom: 24px;
                }

                .page-header h2 {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 0;
                    font-size: 22px;
                    color: #1e293b;
                }

                .page-header p {
                    margin: 4px 0 0;
                    color: #64748b;
                    font-size: 14px;
                }

                .filters-section {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 24px;
                    background: white;
                    padding: 16px;
                    border-radius: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,.06);
                }

                .filter-group {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    flex: 1;
                    min-width: 150px;
                }

                .filter-group label {
                    font-size: 13px;
                    font-weight: 600;
                    color: #475569;
                }

                .filter-select, .filter-input {
                    padding: 10px 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 14px;
                    outline: none;
                }

                .filter-select:focus, .filter-input:focus {
                    border-color: #2563eb;
                    box-shadow: 0 0 0 3px rgba(37,99,235,.1);
                }

                .error-box {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 12px 16px;
                    background: #fef2f2;
                    border: 1px solid #fecaca;
                    border-radius: 8px;
                    color: #dc2626;
                    margin-bottom: 16px;
                    font-size: 14px;
                }

                .tabs-container {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 20px;
                    background: white;
                    padding: 8px;
                    border-radius: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,.06);
                }

                .tab {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 16px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                    color: #64748b;
                    transition: all 0.2s;
                    background: transparent;
                }

                .tab:hover {
                    background: #f1f5f9;
                }

                .tab.active {
                    background: #2563eb;
                    color: white;
                }

                .trips-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 16px;
                }

                .trip-card {
                    background: white;
                    border-radius: 12px;
                    padding: 16px;
                    border: 1px solid #e2e8f0;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 1px 3px rgba(0,0,0,.06);
                    text-align: left;
                    font-family: inherit;
                }

                .trip-card:hover {
                    border-color: #2563eb;
                    box-shadow: 0 4px 12px rgba(37,99,235,.15);
                    transform: translateY(-2px);
                }

                .trip-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid #f1f5f9;
                }

                .trip-date {
                    font-weight: 600;
                    color: #1e293b;
                    font-size: 14px;
                }

                .trip-time {
                    color: #64748b;
                    font-size: 13px;
                }

                .trip-card-body {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .stat {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .stat .label {
                    font-size: 11px;
                    color: #94a3b8;
                    font-weight: 600;
                    text-transform: uppercase;
                }

                .stat .value {
                    font-size: 14px;
                    color: #1e293b;
                    font-weight: 700;
                }

                .trip-card-footer {
                    display: flex;
                    justify-content: center;
                    padding-top: 12px;
                    border-top: 1px solid #f1f5f9;
                }

                .view-btn {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    color: #2563eb;
                    font-size: 13px;
                    font-weight: 600;
                }

                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    color: #94a3b8;
                    font-size: 16px;
                }

                .empty-state svg {
                    margin-bottom: 16px;
                    opacity: 0.5;
                }

                .loading-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    color: #64748b;
                }

                .loading-state .spin {
                    animation: spin 1s linear infinite;
                    margin-bottom: 16px;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                .trip-detail-header {
                    background: white;
                    padding: 20px;
                    border-radius: 12px;
                    margin-bottom: 20px;
                    box-shadow: 0 1px 3px rgba(0,0,0,.06);
                }

                .trip-detail-header h2 {
                    margin: 0 0 8px;
                    color: #1e293b;
                    font-size: 20px;
                }

                .trip-info {
                    margin: 0;
                    color: #64748b;
                    font-size: 14px;
                }

                .trip-stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 12px;
                    margin-top: 16px;
                }

                .stat-card {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding: 12px;
                    background: #f8fafc;
                    border-radius: 8px;
                }

                .stat-label {
                    font-size: 11px;
                    color: #94a3b8;
                    font-weight: 600;
                    text-transform: uppercase;
                }

                .stat-value {
                    font-size: 18px;
                    color: #1e293b;
                    font-weight: 700;
                }

                .trip-map-container {
                    background: white;
                    border-radius: 12px;
                    overflow: hidden;
                    margin-bottom: 20px;
                    box-shadow: 0 1px 3px rgba(0,0,0,.06);
                    height: 400px;
                }

                .stops-list-detail {
                    background: white;
                    padding: 20px;
                    border-radius: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,.06);
                }

                .stops-list-detail h3 {
                    margin: 0 0 16px;
                    color: #1e293b;
                    font-size: 16px;
                }

                .stops-table-wrapper {
                    background: white;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 1px 3px rgba(0,0,0,.06);
                }

                .stops-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 14px;
                }

                .stops-table th {
                    background: #f1f5f9;
                    padding: 12px 16px;
                    text-align: left;
                    font-size: 12px;
                    font-weight: 600;
                    color: #475569;
                }

                .stops-table td {
                    padding: 12px 16px;
                    border-top: 1px solid #f1f5f9;
                    color: #334155;
                }

                .stops-table tr:hover td {
                    background: #fafbfc;
                }

                .coord-badge {
                    display: inline-block;
                    padding: 4px 8px;
                    background: #eff6ff;
                    color: #1d4ed8;
                    border-radius: 4px;
                    font-size: 12px;
                    font-family: monospace;
                }

                .btn-view-trip {
                    padding: 6px 12px;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    transition: all 0.2s;
                }

                .btn-view-trip:hover {
                    background: #1d4ed8;
                }

                @media (max-width: 768px) {
                    .filters-section {
                        flex-direction: column;
                    }

                    .filter-group {
                        min-width: auto;
                    }

                    .trips-grid {
                        grid-template-columns: 1fr;
                    }

                    .stops-table {
                        font-size: 12px;
                    }

                    .stops-table th,
                    .stops-table td {
                        padding: 8px;
                    }
                }
            `}</style>
        </div>
    );
};

export default History;
