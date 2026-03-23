import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Users, MapPin, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import api from '../services/api';

// Icons represent status
const customerIcon = (status, isActive) => {
    let color = '#94a3b8'; // Pending
    if (status === 'completed') color = '#22c55e';
    if (status === 'ongoing') color = '#f59e0b';
    if (isActive) color = '#3b82f6';

    return L.divIcon({
        className: '',
        html: `<div style="background:${color};border:2px solid white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.3)">
                <span style="color:white;font-size:12px;font-weight:bold">${isActive ? '📍' : ''}</span>
               </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
    });
};

const RoutesView = () => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmp, setSelectedEmp] = useState(null);
    const [routeData, setRouteData] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        api.get('/api/trips/employees').then(res => setEmployees(res.data));
    }, []);

    const fetchRoute = async (empId) => {
        setLoading(true);
        try {
            // Note: In a real scenario, the admin might want to see someone else's route.
            // We'll need an endpoint like /api/routes/employee/:id
            // For now, let's assume we use /api/routes/me/route but passing an ID if authorized
            // API implementation needs to support this. I'll add support for employeeId query param.
            const { data } = await api.get(`/api/routes/me/route?employeeId=${empId}`);
            setRouteData(data);
            setSelectedEmp(empId);
        } catch (err) {
            console.error(err);
            setRouteData(null);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-full bg-dark-950 text-white overflow-hidden">
            {/* Sidebar */}
            <aside className="w-80 glass-dark border-r border-white/5 flex flex-col">
                <div className="p-4 border-b border-white/5">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <MapPin className="text-primary-400" size={20} />
                        Monitoreo de Rutas
                    </h2>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Vendedores</label>
                        <div className="grid gap-2">
                            {employees.map(emp => (
                                <button
                                    key={emp.id}
                                    onClick={() => fetchRoute(emp.id)}
                                    className={`flex items-center gap-3 p-3 rounded-xl transition-all border ${
                                        selectedEmp === emp.id 
                                            ? 'bg-primary-500/20 border-primary-500/50 text-white' 
                                            : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
                                    }`}
                                >
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/20 to-blue-500/20 flex items-center justify-center border border-white/10">
                                        <Users size={14} />
                                    </div>
                                    <span className="text-sm font-medium">{emp.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {routeData && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <div className="p-4 rounded-2xl bg-primary-500/10 border border-primary-500/20">
                                <h3 className="text-sm font-bold text-primary-300 mb-1">{routeData.route_name}</h3>
                                <p className="text-xs text-slate-400">Progreso: {routeData.customers.filter(c => c.visit_status === 'completed').length} / {routeData.customers.length}</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Clientes en Ruta</label>
                                {routeData.customers.map((c, idx) => (
                                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all">
                                        <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{c.name}</p>
                                            <p className="text-[10px] text-slate-500 truncate">{c.address}</p>
                                        </div>
                                        {c.visit_status === 'completed' && <CheckCircle className="text-green-500" size={16} />}
                                        {c.visit_status === 'ongoing' && <Clock className="text-yellow-500 animate-pulse" size={16} />}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </aside>

            {/* Map Area */}
            <main className="flex-1 relative">
                {loading && (
                    <div className="absolute inset-0 z-[1001] bg-dark-950/50 backdrop-blur-sm flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-sm font-medium text-primary-400">Cargando ruta...</p>
                        </div>
                    </div>
                )}

                <MapContainer 
                    center={[-12.0464, -77.0428]} 
                    zoom={13} 
                    style={{ height: '100%', width: '100%', background: '#0f172a' }}
                    zoomControl={false}
                >
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                    
                    {routeData?.customers.map(c => (
                        <Marker 
                            key={c.id} 
                            position={[c.lat, c.lng]} 
                            icon={customerIcon(c.visit_status)}
                        >
                            <Popup className="dark-popup">
                                <div className="p-2">
                                    <h4 className="font-bold text-slate-900">{c.name}</h4>
                                    <p className="text-xs text-slate-600 mb-2">{c.address}</p>
                                    <div className={`text-[10px] font-bold uppercase inline-block px-2 py-1 rounded ${
                                        c.visit_status === 'completed' ? 'bg-green-100 text-green-700' :
                                        c.visit_status === 'ongoing' ? 'bg-yellow-100 text-yellow-700' :
                                        'bg-slate-100 text-slate-700'
                                    }`}>
                                        {c.visit_status || 'Pendiente'}
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* Polyline from route cache if exists */}
                    {/* In a real scenario, decoding Google polyline or similar would happen here */}
                </MapContainer>

                {/* Legend */}
                <div className="absolute bottom-6 right-6 z-[1000] glass-dark p-4 rounded-2xl border border-white/10 shadow-2xl space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Leyenda</h4>
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full bg-green-500 shadow-glow-green" />
                            <span className="text-xs font-medium">Visitado</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-glow-yellow" />
                            <span className="text-xs font-medium">En Progreso</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full bg-slate-500" />
                            <span className="text-xs font-medium">Pendiente</span>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default RoutesView;
