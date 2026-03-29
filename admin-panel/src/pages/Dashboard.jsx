import React, { useState, useEffect } from 'react';
import { LogOut, Menu, X, Activity, History, Users, Map as MapIcon, Search, ChevronDown, Power, PowerOff, Radar, RefreshCw, Battery, Zap, Package, ShoppingCart, Settings as SettingsIcon } from 'lucide-react';
import MapView from '../components/MapView';
import Vendors from './Vendors';
import HistoryView from './History';
import RoutesView from './RoutesView';
import CatalogView from './Catalog';
import OrdersView from './Orders';
import SettingsView from './Settings';
import CustomerModal from '../components/CustomerModal';
import ImportJSON from '../components/ImportJSON';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import { FileJson, Plus } from 'lucide-react';
import { useSmartTracking } from '../hooks/useSmartTracking';

const formatTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diffMs = Date.now() - new Date(dateStr).getTime();
    if (diffMs < 60000) return '< 1m';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${hours}h ${mins}m`;
};

const Dashboard = ({ user, onLogout }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [view, setView] = useState('live');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStatus, setSelectedStatus] = useState('all');

    // Smart tracking: polling + interpolación + socket fast-path + heartbeat
    const { locations: activeLocations, liveActiveIds, isConnected, heartbeatStatus, queueStats, liveTrails, liveStops } = useSmartTracking();

    // Customer Management State
    const [customers, setCustomers] = useState([]);
    const [showCustModal, setShowCustModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [clickCoords, setClickCoords] = useState(null);
    const [isDrawingPerimeter, setIsDrawingPerimeter] = useState(false);
    const [pendingCustomerData, setPendingCustomerData] = useState(null);

    useEffect(() => {
        const token = localStorage.getItem('token');
        connectSocket(token);
        
        // join_admins ya no es necesario — el servidor lo hace automáticamente
        // via middleware JWT al conectar. Lo mantenemos como fallback por si
        // el servidor es una versión anterior.
        const onConnect = () => {
            const adminId = user.user?.id || user.id;
            const adminName = user.user?.name || user.name || 'Admin';
            socket.emit('join_admins', { id: adminId, name: adminName });
        };
        socket.on('connect', onConnect);
        // Si ya está conectado, emitir de inmediato
        if (socket.connected) onConnect();

        // Socket solo para comandos de control (tracking toggle, etc.)
        // Las ubicaciones las maneja useSmartTracking con polling + interpolación
        socket.on('tracking_status_changed', (data) => {
            if (!data.employeeId) return;
            setEmployees(prev => prev.map(emp => 
                emp.id === data.employeeId ? { ...emp, is_tracking_enabled: data.enabled } : emp
            ));
        });

        const fetchEmployees = async () => {
            try {
                const { data } = await api.get('/api/trips/employees');
                setEmployees(data);
            } catch (e) { console.error('Error fetching vendors', e); }
        };

        const fetchCustomers = async () => {
            try {
                const { data } = await api.get('/api/customers');
                setCustomers(data);
            } catch (e) { console.error('Error fetching customers', e); }
        };

        fetchEmployees();
        fetchCustomers();

        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);

        return () => {
            socket.off('connect', onConnect);
            socket.off('tracking_status_changed');
            disconnectSocket();
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const toggleTracking = async (e, id, currentStatus) => {
        e.stopPropagation();
        try {
            await api.patch(`/api/employees/${id}/tracking`, { enabled: !currentStatus });
            setEmployees(prev => prev.map(emp => 
                emp.id === id ? { ...emp, is_tracking_enabled: !currentStatus } : emp
            ));
        } catch (e) {
            console.error('Error toggling tracking', e);
            alert('Error al cambiar estado de rastreo');
        }
    };

    // Customer Handlers
    const handleMapClick = (latlng) => {
        if (view !== 'live') return;
        
        // Simplemente cerramos modal previo si estaba abierto
        // Y permitimos que el usuario use Leaflet.Draw libremente si está activo
        if (!isDrawingPerimeter) {
            setClickCoords(latlng);
            // Si no está en modo dibujo, seleccionamos la ubicación como referencia
        }
    };

    const handleCustomerClick = (cust) => {
        setSelectedCustomer(cust);
        setClickCoords({ lat: cust.lat, lng: cust.lng });
        setShowCustModal(true);
    };

    const handleSaveCustomer = async (formData) => {
        if (formData._action === 'start_drawing') {
            setPendingCustomerData(formData);
            setIsDrawingPerimeter(true);
            setShowCustModal(false);
            return;
        }

        try {
            const dataToSave = { ...formData };
            delete dataToSave._action;

            if (selectedCustomer) {
                await api.put(`/api/customers/${selectedCustomer.id}`, dataToSave);
            } else {
                await api.post('/api/customers', dataToSave);
            }
            // Refresh
            const { data } = await api.get('/api/customers');
            setCustomers(data);
            setShowCustModal(false);
            setPendingCustomerData(null);
        } catch (e) {
            console.error('Error saving customer', e);
            alert('Error al guardar cliente');
        }
    };

    const handlePolygonComplete = React.useCallback((polygon, coords) => {
        console.log('[Dashboard] 🎯 handlePolygonComplete llamado', { hasPolygon: !!polygon, coords });
        
        try {
            setIsDrawingPerimeter(false);
            
            // Si coords no viene, usar el primer punto del polígono
            const finalCoords = coords || (polygon ? { lat: polygon.coordinates[0][0][1], lng: polygon.coordinates[0][0][0] } : clickCoords);

            const baseData = pendingCustomerData || {
                lat: finalCoords?.lat || 0,
                lng: finalCoords?.lng || 0,
                name: '',
                address: '',
                min_visit_minutes: 5
            };

            const updatedData = { ...baseData, geofence: polygon };
            delete updatedData._action; // Limpieza
            
            console.log('[Dashboard] ✅ Preparando modal con data:', updatedData);
            setPendingCustomerData(updatedData);
            setClickCoords(finalCoords);
            setSelectedCustomer(null);
            setShowCustModal(true);
        } catch (error) {
            console.error('[Dashboard] ❌ Error en handlePolygonComplete:', error);
            setIsDrawingPerimeter(false);
        }
    }, [pendingCustomerData, clickCoords]);

    const handleCancelDrawing = React.useCallback(() => {
        console.log('[Dashboard] 🛑 Cancelando modo dibujo');
        setIsDrawingPerimeter(false);
        setPendingCustomerData(null);
    }, []);

    const handleDeleteCustomer = async (id) => {
        if (!window.confirm('¿Estás seguro de eliminar este cliente?')) return;
        try {
            await api.delete(`/api/customers/${id}`);
            setCustomers(prev => prev.filter(c => c.id !== id));
            setShowCustModal(false);
        } catch (e) {
            console.error('Error deleting customer', e);
        }
    };

    const handleCustomerMove = async (id, lat, lng) => {
        try {
            await api.put(`/api/customers/${id}`, { lat, lng });
            setCustomers(prev => prev.map(c => c.id === id ? { ...c, lat, lng } : c));
        } catch (e) {
            console.error('Error moving customer', e);
        }
    };

    const handleImportCustomers = async (json) => {
        try {
            await api.post('/api/customers/bulk', json);
            const { data } = await api.get('/api/customers');
            setCustomers(data);
            setShowImportModal(false);
            alert('Importación completada con éxito');
        } catch (e) {
            console.error('Error importing customers', e);
            alert('Error en la importación');
        }
    };
    const activeCount = liveActiveIds.size; // COUNT ONLY LIVE ACTIVE users (last 5 min)

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
        const hbStatus = heartbeatStatus[emp.id]?.liveStatus || (isLive ? 'alive' : 'unknown');
        const hbReason = heartbeatStatus[emp.id]?.reasonLabel || null;
        const trackingScore = heartbeatStatus[emp.id]?.trackingScore ?? null;
        const disconnectionRisk = heartbeatStatus[emp.id]?.disconnectionRisk || 'low';
        const matchesSearch = emp.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             `Vendedor ${emp.id}`.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = selectedStatus === 'all' || (loc && loc.state === selectedStatus);
        
        return {
            ...emp,
            status: loc?.state || 'OFFLINE',
            lastUpdate: loc?.lastUpdate || null,
            speed: loc?.speed || 0,
            accuracy: loc?.accuracy || 999,
            reliability_score: loc?.reliability_score || 1.0,
            confidence: loc?.confidence || 1.0,
            source: loc?.source || 'unknown',
            isLive,
            hbStatus,       // 'alive' | 'stale' | 'offline' | 'dead' | 'unknown'
            hbReason,       // 'Sin GPS' | 'Sin red' | 'App cerrada' | ...
            trackingScore,  // 0–100
            disconnectionRisk, // 'low' | 'medium' | 'high'
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
                    <nav className="hidden md:flex items-center gap-1">
                        <NavLink icon={Activity}    label="En Vivo"   isActive={view === 'live'}    onClick={() => setView('live')}    badge={activeCount} />
                        <NavLink icon={History}     label="Historial" isActive={view === 'history'} onClick={() => setView('history')} />
                        <NavLink icon={Users}       label="Vendedores" isActive={view === 'vendors'} onClick={() => setView('vendors')} />
                        <NavLink icon={MapIcon}     label="Rutas"     isActive={view === 'routes'}  onClick={() => setView('routes')}  />
                        <NavLink icon={Package}     label="Catálogo"  isActive={view === 'catalog'} onClick={() => setView('catalog')} />
                        <NavLink icon={ShoppingCart} label="Pedidos"  isActive={view === 'orders'}  onClick={() => setView('orders')}  />
                        <NavLink icon={SettingsIcon} label="Ajustes"  isActive={view === 'settings'} onClick={() => setView('settings')} />
                    </nav>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-3">
                    {/* Nuevo Cliente Button */}
                    <button
                        onClick={() => {
                            setIsDrawingPerimeter(!isDrawingPerimeter);
                            setShowCustModal(false);
                            setPendingCustomerData(null);
                        }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all border text-sm ${
                            isDrawingPerimeter 
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/30' 
                                : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                        }`}
                        title="Agregar Nuevo Cliente"
                    >
                        {isDrawingPerimeter ? <X size={16} /> : <Plus size={16} />}
                        <span>{isDrawingPerimeter ? 'Cancelar' : 'Nuevo Cliente'}</span>
                    </button>

                    {/* Bulk Import Button */}
                    <button
                        onClick={() => setShowImportModal(true)}
                        className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 font-medium transition-all border border-primary-500/20 text-sm"
                        title="Importar Clientes desde JSON"
                    >
                        <FileJson size={16} />
                        <span>Importar</span>
                    </button>

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

                {/* Sidebar - List of Active Locations (hidden in history view) */}
                <aside className={`
                    ${isMobile ? 'fixed left-0 top-0 bottom-0 z-40' : 'relative'}
                    w-72 glass-dark border-r border-white/5
                    flex flex-col transition-all duration-300
                    ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'}
                    ${view === 'history' ? 'hidden' : ''}
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
                            <>
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                                isConnected 
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-300'
                                    : 'bg-red-500/10 border border-red-500/20 text-red-300'
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                                {isConnected ? 'Sistema en línea' : 'Sin conexión'}
                            </div>

                            {/* 🟢 3: Dashboard de cola BullMQ */}
                            {queueStats && (
                                <div className={`mt-2 px-3 py-2 rounded-lg text-xs border ${
                                    queueStats.workerStatus === 'stale' || queueStats.workerStatus === 'no_stats'
                                        ? 'bg-red-500/10 border-red-500/20 text-red-300'
                                        : queueStats.isBackpressure
                                            ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
                                            : 'bg-white/5 border-white/5 text-slate-400'
                                }`}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium text-slate-300">Cola BullMQ</span>
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                            queueStats.workerStatus === 'stale' ? 'bg-red-500/20 text-red-400 animate-pulse' :
                                            queueStats.workerStatus === 'no_stats' ? 'bg-slate-500/20 text-slate-400' :
                                            'bg-green-500/20 text-green-400'
                                        }`}>
                                            {queueStats.workerStatus === 'stale' ? '⚠️ WORKER MUERTO' :
                                             queueStats.workerStatus === 'no_stats' ? '? SIN DATOS' : '✓ OK'}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                                        <span>⏳ Pendientes: <b className={queueStats.isBackpressure ? 'text-yellow-400' : 'text-white'}>{queueStats.waiting ?? '—'}</b></span>
                                        <span>⚡ Activos: <b className="text-white">{queueStats.active ?? '—'}</b></span>
                                        <span>✅ Completados: <b className="text-white">{queueStats.completed ?? '—'}</b></span>
                                        <span>❌ Fallidos: <b className={queueStats.failed > 0 ? 'text-red-400' : 'text-white'}>{queueStats.failed ?? '—'}</b></span>
                                        {queueStats.jobsPerSec !== null && (
                                            <span className="col-span-2">🚀 Rate: <b className="text-primary-400">{queueStats.jobsPerSec} jobs/s</b></span>
                                        )}
                                        {queueStats.lagMs !== null && queueStats.lagMs !== undefined && (
                                            <span className={`col-span-2 ${queueStats.lagMs > 60000 ? 'text-yellow-400' : ''}`}>
                                                🕐 Lag: <b>{queueStats.lagMs > 60000 ? `${Math.round(queueStats.lagMs/1000)}s ⚠️` : `${Math.round(queueStats.lagMs/1000)}s`}</b>
                                            </span>
                                        )}
                                    </div>
                                    {queueStats.ageSeconds !== undefined && (
                                        <div className="mt-1 text-[10px] text-slate-500">
                                            Actualizado hace {queueStats.ageSeconds}s
                                        </div>
                                    )}
                                </div>
                            )}
                            </>
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
                                        filteredVendors.map(vendor => {
                                            // Color único por vendedor basado en su id
                                            const avatarColors = [
                                                'from-violet-500 to-purple-600',
                                                'from-blue-500 to-cyan-600',
                                                'from-emerald-500 to-teal-600',
                                                'from-orange-500 to-amber-600',
                                                'from-rose-500 to-pink-600',
                                                'from-indigo-500 to-blue-600',
                                            ];
                                            const avatarColor = avatarColors[(vendor.id - 1) % avatarColors.length];
                                            const initials = vendor.name
                                                .split(' ')
                                                .map(w => w[0])
                                                .slice(0, 2)
                                                .join('')
                                                .toUpperCase();

                                            const isSelected = selectedEmployee?.id === vendor.id;

                                            // Estado legible
                                            const diffMs = vendor.lastUpdate ? (Date.now() - new Date(vendor.lastUpdate).getTime()) : Infinity;
                                            const diffMins = Math.floor(diffMs / 60000);
                                            const diffSec = Math.floor(diffMs / 1000);
                                            const timeLabel = diffSec < 60 ? `${diffSec}s` : diffMins < 60 ? `${diffMins}m` : `${Math.floor(diffMins/60)}h`;
                                            const latencyColor = diffSec < 15 ? 'text-green-400' : diffSec < 120 ? 'text-yellow-400' : 'text-slate-500';

                                            let statusDot = 'bg-slate-600';
                                            let statusLabel = 'Sin datos';
                                            let statusColor = 'text-slate-400';
                                            if (vendor.hbStatus === 'alive') { statusDot = 'bg-green-400 animate-pulse shadow-green-400/60 shadow-sm'; statusLabel = 'En línea'; statusColor = 'text-green-400'; }
                                            else if (vendor.hbStatus === 'stale') { statusDot = 'bg-yellow-400'; statusLabel = 'Inactivo'; statusColor = 'text-yellow-400'; }
                                            else if (vendor.hbStatus === 'offline') { statusDot = 'bg-red-500'; statusLabel = 'Offline'; statusColor = 'text-red-400'; }
                                            else if (vendor.hbStatus === 'dead') { statusDot = 'bg-slate-600'; statusLabel = 'Sin señal'; statusColor = 'text-slate-500'; }

                                            const movementIcon = {
                                                DRIVING: '🚗', En_auto: '🚗',
                                                WALKING: '🚶', A_pie: '🚶',
                                                STOPPED: '⏸', DEEP_SLEEP: '😴',
                                                BATT_SAVER: '🔋', GPS_OFF: '📵',
                                            }[vendor.status?.replace(' ', '_')] || '📍';

                                            return (
                                            <div
                                                key={vendor.id}
                                                onClick={() => {
                                                    setSelectedEmployee(isSelected ? null : vendor);
                                                    isMobile && setSidebarOpen(false);
                                                }}
                                                className={`rounded-xl cursor-pointer transition-all duration-200 border overflow-hidden ${
                                                    isSelected
                                                        ? 'bg-primary-600/15 border-primary-500/40 shadow-lg shadow-primary-500/10'
                                                        : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.07] hover:border-white/10'
                                                }`}
                                            >
                                                {/* Barra de color superior si está seleccionado */}
                                                {isSelected && <div className={`h-0.5 w-full bg-gradient-to-r ${avatarColor}`} />}

                                                <div className="p-3">
                                                    {/* Fila principal: avatar + nombre + acciones */}
                                                    <div className="flex items-center gap-3">
                                                        {/* Avatar con iniciales */}
                                                        <div className="relative flex-shrink-0">
                                                            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white text-xs font-bold shadow-md`}>
                                                                {initials}
                                                            </div>
                                                            {/* Dot de estado sobre el avatar */}
                                                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-950 ${statusDot}`} />
                                                        </div>

                                                        {/* Nombre + estado */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="text-sm font-semibold text-white truncate">{vendor.name}</span>
                                                                {vendor.trackingScore !== null && (
                                                                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0 ${
                                                                        vendor.trackingScore >= 70 ? 'bg-green-500/20 text-green-400' :
                                                                        vendor.trackingScore >= 40 ? 'bg-yellow-500/20 text-yellow-400' :
                                                                        'bg-red-500/20 text-red-400'
                                                                    }`}>⚡{vendor.trackingScore}</span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <span className={`text-[11px] font-medium ${statusColor}`}>{statusLabel}</span>
                                                                {vendor.lastUpdate && (
                                                                    <span className={`text-[10px] font-mono ${latencyColor}`}>· {timeLabel}</span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Acciones */}
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); requestLocate(e, vendor.id); }}
                                                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                                                                    vendor.isLive ? 'text-primary-400 hover:bg-primary-500/20' : 'text-slate-600 opacity-50'
                                                                }`}
                                                                title="Localizar ahora"
                                                            >
                                                                <Radar size={13} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => toggleTracking(e, vendor.id, vendor.is_tracking_enabled ?? true)}
                                                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                                                                    (vendor.is_tracking_enabled ?? true)
                                                                        ? 'text-green-400 hover:bg-green-500/20'
                                                                        : 'text-slate-500 hover:bg-white/10'
                                                                }`}
                                                                title={(vendor.is_tracking_enabled ?? true) ? "Pausar rastreo" : "Activar rastreo"}
                                                            >
                                                                {(vendor.is_tracking_enabled ?? true) ? <Power size={13} /> : <PowerOff size={13} />}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Fila secundaria: velocidad + batería + estado GPS */}
                                                    <div className="mt-2.5 flex items-center justify-between pl-12">
                                                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                                                            <span>{movementIcon} {vendor.speed > 0 ? `${vendor.speed.toFixed(0)} km/h` : '—'}</span>
                                                            {vendor.battery !== undefined && (
                                                                <span className="flex items-center gap-0.5">
                                                                    {vendor.is_charging
                                                                        ? <Zap size={9} className="text-yellow-400" />
                                                                        : <Battery size={9} className={vendor.battery < 20 ? 'text-red-400' : ''} />
                                                                    }
                                                                    <span className={vendor.battery < 20 ? 'text-red-400' : ''}>{vendor.battery}%</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                        {/* Chip de estado GPS */}
                                                        {vendor.hbReason && vendor.hbStatus !== 'alive' && (
                                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                                                                vendor.hbStatus === 'dead' ? 'bg-slate-700/80 text-slate-400' :
                                                                vendor.hbStatus === 'offline' ? 'bg-red-500/15 text-red-400' :
                                                                'bg-yellow-500/15 text-yellow-400'
                                                            }`}>{vendor.hbReason}</span>
                                                        )}
                                                        {vendor.disconnectionRisk === 'high' && (
                                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 animate-pulse font-medium">⚠ Riesgo</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            );
                                        })
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
                    {view === 'vendors'  ? <Vendors /> 
                    : view === 'history'  ? <HistoryView user={user} />
                    : view === 'routes'   ? <RoutesView />
                    : view === 'catalog'  ? <CatalogView />
                    : view === 'orders'   ? <OrdersView user={user} />
                    : view === 'settings' ? <SettingsView />
                    : (
                        <MapView
                            view={view}
                            selectedEmployee={selectedEmployee}
                            activeLocations={activeLocations}
                            heartbeatStatus={heartbeatStatus}
                            liveTrails={liveTrails}
                            liveStops={liveStops}
                            customers={customers}
                            onMapClick={handleMapClick}
                            onCustomerMove={handleCustomerMove}
                            onCustomerClick={handleCustomerClick}
                            clickCoords={clickCoords}
                            isDrawingPerimeter={isDrawingPerimeter}
                            onPolygonComplete={handlePolygonComplete}
                            onCancelDrawing={handleCancelDrawing}
                        />
                    )}
                </main>
            </div>

            {/* Modals */}
            <CustomerModal
                isOpen={showCustModal}
                onClose={() => {
                    setShowCustModal(false);
                    setPendingCustomerData(null);
                }}
                onSave={handleSaveCustomer}
                onDelete={handleDeleteCustomer}
                customer={selectedCustomer}
                initialCoords={clickCoords}
                initialData={pendingCustomerData}
            />

            {showImportModal && (
                <ImportJSON
                    onImport={handleImportCustomers}
                    onClose={() => setShowImportModal(false)}
                />
            )}
        </div>
    );
};

export default Dashboard;
