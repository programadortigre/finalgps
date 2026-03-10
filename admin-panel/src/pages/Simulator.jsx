import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';
import dayjs from 'dayjs';
import { MousePointer2, Car, Footprints, Timer, Save, Trash2, UserPlus, MapPin } from 'lucide-react';

// Helper component for map events, defined outside to avoid re-mounting
const MapEvents = ({ onClick }) => {
    useMapEvents({
        click: (e) => {
            onClick(e.latlng.lat, e.latlng.lng);
        }
    });
    return null;
};

const Simulator = ({ employees }) => {
    const [points, setPoints] = useState([]);
    const [mode, setMode] = useState('drive'); // 'drive' | 'walk' | 'stop'
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [startTime, setStartTime] = useState('08:00');
    const [stopDuration, setStopDuration] = useState(15);
    const [clients, setClients] = useState([]);
    const [clientForm, setClientForm] = useState({ name: '', address: '' });
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState({ count: 0, distance: 0 });

    const lastTimestampRef = useRef(null);

    useEffect(() => {
        // Fetch existing clients to show on map
        api.get('/api/clients').then(res => setClients(res.data)).catch(console.error);
    }, []);

    const haversine = (lat1, lng1, lat2, lng2) => {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    const simulateMovement = (last, targetLat, targetLng, distance) => {
        const speed = mode === 'drive' ? 14 : 1.4; // m/s
        const timeDiff = distance / speed;
        const numSteps = Math.ceil(timeDiff / 30);

        const newPoints = [];
        let currentTs = lastTimestampRef.current;
        let totalDist = stats.distance;

        for (let i = 1; i <= numSteps; i++) {
            const ratio = i / numSteps;
            const lat = last.lat + (targetLat - last.lat) * ratio;
            const lng = last.lng + (targetLng - last.lng) * ratio;
            currentTs += 30000;
            newPoints.push({ lat, lng, speed, accuracy: 5, timestamp: currentTs });
            totalDist += (distance / numSteps);
        }

        lastTimestampRef.current = currentTs;
        setPoints(prev => [...prev, ...newPoints]);
        setStats(prev => ({ count: prev.count + numSteps, distance: totalDist }));
        console.log(`[Simulator] Generated ${numSteps} points for movement`);
    };

    const simulateStop = (lat, lng) => {
        const numPoints = Math.ceil(stopDuration * 60 / 30);
        const newPoints = [];
        let currentTs = lastTimestampRef.current;

        for (let i = 0; i < numPoints; i++) {
            currentTs += 30000;
            const jitterLat = lat + (Math.random() - 0.5) * 0.0001;
            const jitterLng = lng + (Math.random() - 0.5) * 0.0001;
            newPoints.push({ lat: jitterLat, lng: jitterLng, speed: 0.1, accuracy: 15, timestamp: currentTs });
        }

        lastTimestampRef.current = currentTs;
        setPoints(prev => [...prev, ...newPoints]);
        setStats(prev => ({ ...prev, count: prev.count + numPoints }));
        console.log(`[Simulator] Generated ${numPoints} points for stop`);
    };

    const handleMapClick = (lat, lng) => {
        console.log('[Simulator] Map clicked:', { lat, lng }, 'Employee:', selectedEmployee);

        if (!selectedEmployee) {
            alert('Por favor selecciona un vendedor primero');
            return;
        }

        if (points.length === 0) {
            const ts = dayjs(`${date} ${startTime}`).valueOf();
            lastTimestampRef.current = ts;
            const newPoint = { lat, lng, speed: 0, accuracy: 10, timestamp: ts };
            setPoints([newPoint]);
            setStats({ count: 1, distance: 0 });
            console.log('[Simulator] Started new trajectory at:', newPoint);
        } else {
            const last = points[points.length - 1];
            const dist = haversine(last.lat, last.lng, lat, lng);

            if (mode === 'stop') {
                simulateStop(lat, lng);
            } else {
                simulateMovement(last, lat, lng, dist);
            }
        }
    };

    const registerTrajectory = async () => {
        if (points.length === 0) return;
        setLoading(true);
        try {
            await api.post('/api/locations/admin-simulate', {
                employeeId: selectedEmployee,
                points
            });
            alert('Trayectoria registrada con éxito. El worker la procesará en breve.');
            clearAll();
        } catch (e) {
            alert('Error al registrar trayectoria: ' + (e.response?.data?.error || e.message));
        } finally {
            setLoading(false);
        }
    };

    const registerClient = async () => {
        if (!clientForm.name || points.length === 0) {
            alert('Nombre y punto en el mapa requeridos');
            return;
        }
        const last = points[points.length - 1];
        try {
            const { data } = await api.post('/api/clients', {
                ...clientForm,
                lat: last.lat,
                lng: last.lng
            });
            setClients(prev => [...prev, data]);
            alert('Cliente registrado: ' + data.name);
            setClientForm({ name: '', address: '' });
        } catch (e) {
            alert('Error al crear cliente');
        }
    };

    const clearAll = () => {
        setPoints([]);
        setStats({ count: 0, distance: 0 });
        lastTimestampRef.current = null;
    };

    return (
        <div className="simulator-container">
            <div className="simulator-sidebar">
                <header className="sim-header">
                    <h2>Creador de Escenarios</h2>
                    <p>Dibuja recorridos y simula visitas</p>
                </header>

                <div className="sim-section">
                    <label>Vendedor y Fecha</label>
                    <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)}>
                        <option value="">Seleccionar Vendedor...</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    <div className="flex-row">
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                    </div>
                </div>

                <div className="sim-section">
                    <label>Modo de Movimiento</label>
                    <div className="mode-tabs">
                        <button className={mode === 'drive' ? 'active' : ''} onClick={() => setMode('drive')}><Car size={16} /> Vehículo</button>
                        <button className={mode === 'walk' ? 'active' : ''} onClick={() => setMode('walk')}><Footprints size={16} /> Pie</button>
                        <button className={mode === 'stop' ? 'active' : ''} onClick={() => setMode('stop')}><Timer size={16} /> Parada</button>
                    </div>
                    {mode === 'stop' && (
                        <div className="stop-input">
                            <span>Duración (min)</span>
                            <input type="number" value={stopDuration} onChange={e => setStopDuration(e.target.value)} />
                        </div>
                    )}
                </div>

                <div className="sim-section stats-grid">
                    <div className="stat-item">
                        <span className="val">{stats.count}</span>
                        <span className="lbl">Puntos</span>
                    </div>
                    <div className="stat-item">
                        <span className="val">{(stats.distance / 1000).toFixed(2)}</span>
                        <span className="lbl">KM</span>
                    </div>
                </div>

                <div className="sim-section clients-form">
                    <label>Nuevo Cliente (en último punto)</label>
                    <input type="text" placeholder="Nombre (ej: Tienda Naturista)" value={clientForm.name} onChange={e => setClientForm({ ...clientForm, name: e.target.value })} />
                    <input type="text" placeholder="Dirección" value={clientForm.address} onChange={e => setClientForm({ ...clientForm, address: e.target.value })} />
                    <button className="btn-secondary" onClick={registerClient}><UserPlus size={16} /> Crear Cliente</button>
                </div>

                <footer className="sim-footer">
                    <button className="btn-primary" onClick={registerTrajectory} disabled={loading || points.length === 0}>
                        <Save size={18} /> {loading ? 'Enviando...' : 'Registrar Recorrido'}
                    </button>
                    <button className="btn-ghost" onClick={clearAll}><Trash2 size={16} /> Limpiar</button>
                </footer>
            </div>

            <div className="simulator-map">
                <MapContainer center={[-12.0464, -77.0428]} zoom={15} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                    <MapEvents onClick={handleMapClick} />

                    {points.length > 1 && (
                        <Polyline positions={points.map(p => [p.lat, p.lng])} color="#6366f1" weight={4} opacity={0.6} />
                    )}

                    {points.map((p, i) => (
                        i === points.length - 1 && (
                            <Marker key={i} position={[p.lat, p.lng]} icon={L.divIcon({
                                className: 'last-point-marker',
                                html: '<div class="pulse-dot"></div>',
                                iconSize: [12, 12]
                            })} />
                        )
                    ))}

                    {clients.map(c => (
                        <Marker key={c.id} position={[c.lat, c.lng]} icon={L.divIcon({
                            className: 'client-marker',
                            html: '<div class="client-dot"></div>',
                            iconSize: [12, 12]
                        })}>
                            <Popup><strong>{c.name}</strong><br />{c.address}</Popup>
                        </Marker>
                    ))}
                </MapContainer>
            </div>

            <style>{`
                .simulator-container { display: flex; height: 100%; width: 100%; background: #0f172a; overflow: hidden; }
                
                .simulator-sidebar { 
                    width: 320px; background: white; border-right: 1px solid #e2e8f0; 
                    display: flex; flex-direction: column; overflow-y: auto; padding: 20px;
                }

                .sim-header h2 { margin: 0; font-size: 18px; color: #1e293b; font-weight: 700; }
                .sim-header p { margin: 4px 0 20px; font-size: 13px; color: #64748b; }

                .sim-section { margin-bottom: 24px; display: flex; flex-direction: column; gap: 8px; }
                .sim-section label { font-size: 12px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
                
                select, input { padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; font-size: 14px; }
                select:focus, input:focus { border-color: #6366f1; }
                .flex-row { display: flex; gap: 8px; }
                .flex-row input { flex: 1; }

                .mode-tabs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 10px; }
                .mode-tabs button { 
                    border: none; background: transparent; padding: 8px; border-radius: 8px; 
                    font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer;
                    display: flex; flex-direction: column; align-items: center; gap: 4px; transition: all 0.2s;
                }
                .mode-tabs button.active { background: white; color: #6366f1; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }

                .stop-input { display: flex; align-items: center; justify-content: space-between; padding-top: 4px; }
                .stop-input span { font-size: 12px; color: #64748b; }
                .stop-input input { width: 60px; text-align: center; }

                .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .stat-item { background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 12px; text-align: center; }
                .stat-item .val { display: block; font-size: 18px; font-weight: 700; color: #1e293b; }
                .stat-item .lbl { font-size: 11px; color: #94a3b8; text-transform: uppercase; }

                .btn-primary { 
                    background: #6366f1; color: white; border: none; padding: 12px; 
                    border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; 
                    align-items: center; justify-content: center; gap: 8px; margin-top: auto;
                }
                .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
                .btn-secondary { background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; padding: 10px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; }
                .btn-ghost { background: transparent; border: none; color: #94a3b8; padding: 10px; cursor: pointer; font-size: 13px; }

                .simulator-map { flex: 1; border-radius: 20px; margin: 12px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.2); }

                /* Markers */
                .pulse-dot { width: 12px; height: 12px; background: #6366f1; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px #6366f1; animation: pulse 1.5s infinite; }
                @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.5); opacity: 0; } }
                
                .client-dot { width: 12px; height: 12px; background: #10b981; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 6px rgba(0,0,0,0.2); }
            `}</style>
        </div>
    );
};

export default Simulator;
