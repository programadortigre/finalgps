import React, { useState, useEffect } from 'react';
import { LogOut, Menu, X, Activity, History, Users, Search, ChevronDown, Power, PowerOff, Radar, RefreshCw } from 'lucide-react';
import MapView from '../components/MapView';
import Vendors from './Vendors';
import HistoryView from './History';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';

const Dashboard = ({ user, onLogout }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [activeLocations, setActiveLocations] = useState({});
    const [liveActiveIds, setLiveActiveIds] = useState(new Set()); // Empleados activos last 5 min
    const [view, setView] = useState('live');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStatus, setSelectedStatus] = useState('all');
    const [isConnected, setIsConnected] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        connectSocket(token);
        setIsConnected(true);
        
        const adminId = user.user?.id || user.id;
        const adminName = user.user?.name || user.name || 'Admin';
        socket.emit('join_admins', { id: adminId, name: adminName });

        socket.on('location_update', (data) => {
            if (!data.employeeId) return;
            setActiveLocations(prev => ({
                ...prev,
                [data.employeeId]: { 
                    ...(prev[data.employeeId] || {}), 
                    ...data, 
                    lastUpdate: new Date().toISOString() 
                }
            }));
            // Mark as live active when receiving real-time update
            setLiveActiveIds(prev => new Set([...prev, data.employeeId]));
        });

        socket.on('disconnect', () => setIsConnected(false));
        socket.on('connect', () => setIsConnected(true));

        const fetchEmployees = async () => {
            try {
                const { data } = await api.get('/api/trips/employees');
                setEmployees(data);
            } catch (e) { console.error('Error fetching vendors', e); }
        };

        const fetchLatestLocations = async () => {
            try {
                // Get ALL locations (includes inactive employees)
                const { data } = await api.get('/api/locations');
                const initialLocations = {};
                data.forEach(loc => {
                    initialLocations[loc.employeeId] = loc;
                });
                setActiveLocations(initialLocations);
            } catch (e) { console.error('Error fetching latest locations', e); }
        };

        const fetchLiveActive = async () => {
            try {
                // Get ONLY employees active in last 5 minutes
                const { data } = await api.get('/api/locations/active');
                const activeIds = new Set(data.map(loc => loc.employeeId));
                setLiveActiveIds(activeIds);
            } catch (e) { console.error('Error fetching live active locations', e); }
        };

        fetchEmployees();
        fetchLatestLocations();
        fetchLiveActive(); // Initial live status

        // Refresh live status every 30 seconds
        const liveInterval = setInterval(fetchLiveActive, 30000);

        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);

        return () => {
            socket.off('location_update');
            socket.off('disconnect');
            socket.off('connect');
            disconnectSocket();
            clearInterval(liveInterval);
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const toggleTracking = async (e, id, currentStatus) => {
        e.stopPropagation(); // Evitar seleccionar empleado al tocar el switch
        try {
            await api.patch(`/api/employees/${id}/tracking`, { enabled: !currentStatus });
            // Actualizar localmente la lista de empleados
            setEmployees(prev => prev.map(emp => 
                emp.id === id ? { ...emp, is_tracking_enabled: !currentStatus } : emp
            ));
            // También actualizar en activeLocations si existe para refrescar el mapa si es necesario
            setActiveLocations(prev => {
                const updated = { ...prev };
                if (updated[id]) {
                    // Si el admin apaga el rastreo, podríamos querer marcarlo visualmente
                    // Aunque socket emitirá la señal, esto ayuda a la respuesta inmediata de la UI
                }
                return updated;
            });
        } catch (e) {
            console.error('Error toggling tracking', e);
            alert('Error al cambiar estado de rastreo');
        }
    };    const activeCount = liveActiveIds.size; // COUNT ONLY LIVE ACTIVE users (last 5 min)

    const requestLocate = (e, employeeId) => {
        e.stopPropagation();
        const adminId = user.user?.id || user.id;
        socket.emit('admin_request_location', { employeeId, adminId });
        console.log(`Requested location for ${employeeId}`);
    };

    // Merge employees with their latest status for the sidebar
    const vendorsWithStatus = employees.map(emp => {
        const loc = activeLocations[emp.id];
        const isLive = liveActiveIds.has(emp.id);
        const matchesSearch = emp.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             `Vendedor ${emp.id}`.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = selectedStatus === 'all' || (loc && loc.state === selectedStatus);
        
        return {
            ...emp,
            status: loc?.state || 'OFFLINE',
            lastUpdate: loc?.lastUpdate || null,
            speed: loc?.speed || 0,
            accuracy: loc?.accuracy || 999,
            isLive,
            isVisible: matchesSearch && matchesStatus
        };
    });

    const filteredVendors = vendorsWithStatus.filter(v => v.isVisible);

    // Calculate stats only for LIVE active users
    const liveActiveLocations = Object.values(activeLocations).filter(loc => liveActiveIds.has(loc.employeeId));
    const statusStats = {
        'Quieto': liveActiveLocations.filter(l => l.state === 'Quieto' || l.state === 'SIN_MOVIMIENTO' || l.state === 'STOPPED' || l.state === 'DEEP_SLEEP').length,
        'A pie': liveActiveLocations.filter(l => l.state === 'A pie' || l.state === 'CAMINANDO' || l.state === 'WALKING').length,
        'Lento': liveActiveLocations.filter(l => l.state === 'Lento' || l.state === 'MOVIMIENTO_LENTO' || l.state === 'BATT_SAVER' || l.state === 'NO_SIGNAL').length,
        'En auto': liveActiveLocations.filter(l => l.state === 'En auto' || l.state === 'VEHICULO' || l.state === 'DRIVING').length,
    };

    const NavLink = ({ icon: Icon, label, isActive, onClick, badge }) => (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
                isActive
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
        >
            <Icon size={18} />
            <span>{label}</span>
            {badge && badge > 0 && (
                <span className="ml-auto text-xs font-bold bg-primary-500 text-white px-2 py-0.5 rounded-full">
                    {badge}
                </span>
            )}
        </button>
    );

    return (
        <div className="h-screen flex flex-col bg-dark-950 text-white font-sans overflow-hidden">
            {/* Top Navigation Bar */}
            <header className="glass-dark border-b border-white/5 px-6 py-4 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-4">
                    {/* Brand */}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500/20 to-blue-600/20 border border-primary-500/20 flex items-center justify-center text-lg shadow-glow">
                            📍
                        </div>
                        <div>
                            <h1 className="font-bold text-white">Tracker Pro</h1>
                            <p className="text-xs text-slate-400">{user.user?.name || user.name || 'Admin'}</p>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="hidden md:block w-px h-8 bg-white/10"></div>

                    {/* Navigation Links */}
                    <nav className="hidden md:flex items-center gap-2">
                        <NavLink
                            icon={Activity}
                            label="En Vivo"
                            isActive={view === 'live'}
                            onClick={() => setView('live')}
                            badge={activeCount}
                        />
                        <NavLink
                            icon={History}
                            label="Historial"
                            isActive={view === 'history'}
                            onClick={() => setView('history')}
                        />
                        <NavLink
                            icon={Users}
                            label="Vendedores"
                            isActive={view === 'vendors'}
                            onClick={() => setView('vendors')}
                        />
                    </nav>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-3">
                    {/* Mobile Menu Button */}
                    {isMobile && (
                        <button
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                        >
                            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
                        </button>
                    )}

                    {/* Mobile Nav Dropdown */}
                    {isMobile && (
                        <div className="relative group">
                            <button className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white">
                                <ChevronDown size={18} />
                            </button>
                            <div className="absolute right-0 top-full mt-1 bg-dark-900 border border-white/10 rounded-lg shadow-xl space-y-1 p-2 min-w-[180px] z-50 hidden group-hover:block">
                                <button onClick={() => { setView('live'); setSidebarOpen(true); }} className="w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors flex items-center gap-2">
                                    <Activity size={16} /> En Vivo
                                </button>
                                <button onClick={() => { setView('history'); setSidebarOpen(true); }} className="w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors flex items-center gap-2">
                                    <History size={16} /> Historial
                                </button>
                                <button onClick={() => { setView('vendors'); setSidebarOpen(true); }} className="w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors flex items-center gap-2">
                                    <Users size={16} /> Vendedores
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Logout Button */}
                    <button
                        onClick={onLogout}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium transition-all border border-red-500/20 text-sm"
                    >
                        <LogOut size={16} />
                        <span className="hidden sm:inline">Salir</span>
                    </button>
                </div>
            </header>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Mobile Overlay */}
                {isMobile && sidebarOpen && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30" onClick={() => setSidebarOpen(false)} />
                )}

                {/* Sidebar - List of Active Locations */}
                <aside className={`
                    ${isMobile ? 'fixed left-0 top-0 bottom-0 z-40' : 'relative'}
                    w-72 glass-dark border-r border-white/5
                    flex flex-col transition-all duration-300
                    ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'}
                `} style={{marginTop: isMobile ? '68px' : '0'}}>
                    
                    {/* Sidebar Header */}
                    <div className="p-4 border-b border-white/5 flex-shrink-0">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="font-bold text-white">
                                {view === 'live' ? 'Activos en Vivo' : view === 'history' ? 'Vendedores' : 'Gestión'}
                            </h2>
                            {isMobile && (
                                <button
                                    onClick={() => setSidebarOpen(false)}
                                    className="p-1 hover:bg-white/10 rounded transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            )}
                        </div>

                        {/* Status Indicator */}
                        {view === 'live' && (
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                                isConnected 
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-300'
                                    : 'bg-red-500/10 border border-red-500/20 text-red-300'
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                                {isConnected ? 'Sistema en línea' : 'Sin conexión'}
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-4">
                        {view === 'live' && (
                            <>
                                {/* Search */}
                                <div className="relative flex-shrink-0">
                                    <Search size={16} className="absolute left-3 top-3 text-slate-500" />
                                    <input
                                        type="text"
                                        placeholder="Buscar..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:bg-white/10 outline-none text-sm transition-all"
                                    />
                                </div>

                                {/* Status Filter */}
                                <select
                                    value={selectedStatus}
                                    onChange={(e) => setSelectedStatus(e.target.value)}
                                    className="flex-shrink-0 w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                >
                                    <option value="all">Todos ({activeCount})</option>
                                    <option value="En auto">🚙 En auto ({statusStats['En auto']})</option>
                                    <option value="A pie">🚶 A pie ({statusStats['A pie']})</option>
                                    <option value="Lento">🚲 Lento ({statusStats['Lento']})</option>
                                    <option value="Quieto">⏸️ Quieto ({statusStats['Quieto']})</option>
                                </select>

                                {/* Live List */}
                                <div className="flex-1 overflow-y-auto space-y-2">
                                    {filteredVendors.length === 0 ? (
                                        <div className="text-center py-8">
                                            <p className="text-slate-500 text-sm">Sin coincidencias</p>
                                        </div>
                                    ) : (
                                        filteredVendors.map(vendor => (
                                            <div
                                                key={vendor.id}
                                                onClick={() => {
                                                    setSelectedEmployee(selectedEmployee?.id === vendor.id ? null : vendor);
                                                    isMobile && setSidebarOpen(false);
                                                }}
                                                className={`p-3 rounded-lg cursor-pointer transition-all border group ${
                                                    selectedEmployee?.id === vendor.id
                                                        ? 'bg-primary-600/20 border-primary-500/30'
                                                        : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className={`w-2.5 h-2.5 rounded-full ${
                                                        vendor.isLive ? 'bg-green-400 shadow-lg shadow-green-400/50 animate-pulse' :
                                                        (vendor.status === 'OFFLINE' ? 'bg-slate-700' : 'bg-slate-500')
                                                     }`} />
                                                    <span className="font-medium text-sm flex-1 group-hover:text-primary-300">{vendor.name}</span>
                                                    
                                                    {/* Locate Now Button */}
                                                    <button 
                                                        onClick={(e) => requestLocate(e, vendor.id)}
                                                        className="p-1.5 rounded-lg text-primary-400 hover:bg-primary-500/20 transition-all"
                                                        title="Localizar ahora"
                                                    >
                                                        <Radar size={14} />
                                                    </button>

                                                    {/* Quick Control */}
                                                    <button 
                                                        onClick={(e) => toggleTracking(e, vendor.id, vendor.is_tracking_enabled ?? true)}
                                                        className={`p-1.5 rounded-lg transition-all ${
                                                            (vendor.is_tracking_enabled ?? true)
                                                                ? 'text-green-400 hover:bg-green-500/20'
                                                                : 'text-slate-500 hover:bg-slate-500/20'
                                                        }`}
                                                        title={vendor.is_tracking_enabled === false ? "Activar Rastreo" : "Desactivar Rastreo"}
                                                    >
                                                        {(vendor.is_tracking_enabled ?? true) ? <Power size={14} /> : <PowerOff size={14} />}
                                                    </button>
                                                </div>
                                                <div className="text-xs text-slate-400 space-y-1 pl-5 flex justify-between items-end">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] opacity-70">⚡ {vendor.speed ? (vendor.speed.toFixed(1) + ' km/h') : '---'}</span>
                                                            
                                                            {/* ✅ Dashboard Nivel Uber: Estados Compuestos */}
                                                             {vendor.lastUpdate && (
                                                                 <span className={`text-[10px] px-1.5 py-0.5 rounded-sm flex items-center gap-1 font-medium ${
                                                                     vendor.is_stale ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' :
                                                                     vendor.status === 'GPS_OFF' ? 'bg-red-600 text-white font-bold animate-pulse' :
                                                                     vendor.reset_reason && vendor.reset_reason.includes('recovery') ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                                                                     (vendor.confidence || 1.0) >= 0.8 ? 'bg-green-500/10 text-green-400' :
                                                                     (vendor.confidence || 1.0) >= 0.4 ? 'bg-yellow-500/10 text-yellow-400' :
                                                                     'bg-red-500/10 text-red-400'
                                                                 }`}>
                                                                     {vendor.is_stale ? '⚠️ Desactualizado' : 
                                                                      vendor.status === 'GPS_OFF' ? '⛔ GPS Apagado' :
                                                                      vendor.reset_reason && vendor.reset_reason.includes('recovery') ? '🔄 Recuperando' :
                                                                      (vendor.confidence || 1.0) >= 0.8 ? '🟢 En Vivo' : 
                                                                      (vendor.confidence || 1.0) >= 0.4 ? '🟡 Baja Precisión' : '🔴 Sin GPS'}
                                                                 </span>
                                                             )}
                                                        </div>
                                                        <div className="text-slate-500 flex items-center gap-2">
                                                            <span>{vendor.lastUpdate ? new Date(vendor.lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Offline'}</span>
                                                            {/* ✅ Tiempo Transcurrido (Stale Time) */}
                                                            {vendor.lastUpdate && (
                                                                <span className="text-[9px] opacity-50 italic">
                                                                    ({Math.floor((new Date() - new Date(vendor.lastUpdate)) / 60000)}m atrás)
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {vendor.isLive && <span className="text-[9px] text-green-500 font-bold uppercase tracking-wider">Live</span>}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </>
                        )}

                        {view === 'history' && employees.length > 0 && (
                            <div className="flex-1 overflow-y-auto space-y-2">
                                {employees.map(e => (
                                    <div
                                        key={e.id}
                                        onClick={() => { setSelectedEmployee(e); isMobile && setSidebarOpen(false); }}
                                        className={`p-3 rounded-lg cursor-pointer transition-all border group ${
                                            selectedEmployee?.id === e.id
                                                ? 'bg-primary-600/20 border-primary-500/30'
                                                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2.5 h-2.5 rounded-full ${activeLocations[e.id] ? 'bg-green-400' : 'bg-slate-500'}`} />
                                            <span className="text-sm font-medium group-hover:text-primary-300 flex-1">{e.name}</span>
                                            
                                            {/* Quick Control */}
                                            <button 
                                                onClick={(e_ev) => toggleTracking(e_ev, e.id, e.is_tracking_enabled)}
                                                className={`p-1.5 rounded-lg transition-all ${
                                                    e.is_tracking_enabled 
                                                        ? 'text-green-400 hover:bg-green-500/20' 
                                                        : 'text-slate-500 hover:bg-slate-500/20'
                                                }`}
                                                title={e.is_tracking_enabled ? "Desactivar Rastreo" : "Activar Rastreo"}
                                            >
                                                {e.is_tracking_enabled ? <Power size={14} /> : <PowerOff size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </aside>

                {/* Main Content - Map / Views */}
                <main className="flex-1 overflow-hidden relative">
                    {view === 'vendors' ? (
                        <Vendors />
                    ) : view === 'history' ? (
                        <HistoryView user={user} />
                    ) : (
                        <MapView
                            view={view}
                            selectedEmployee={selectedEmployee}
                            activeLocations={activeLocations}
                        />
                    )}
                </main>
            </div>
        </div>
    );
};

export default Dashboard;
