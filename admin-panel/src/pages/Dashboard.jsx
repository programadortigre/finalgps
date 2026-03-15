import React, { useState, useEffect } from 'react';
import { LogOut, Users, History, Activity, UserCog, Search, Filter, Wifi, WifiOff } from 'lucide-react';
import MapView from '../components/MapView';
import Vendors from './Vendors';
import HistoryView from './History';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';

const Dashboard = ({ user, onLogout }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [activeLocations, setActiveLocations] = useState({});
    const [view, setView] = useState('live'); // 'live' | 'history' | 'vendors'
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStatus, setSelectedStatus] = useState('all'); // 'all' | 'Quieto' | 'A pie' | 'Lento' | 'En auto'
    const [isConnected, setIsConnected] = useState(true);

    useEffect(() => {
        connectSocket();
        setIsConnected(true);
        
        // ✅ Suscribirse a la sala de admins con join_admins event
        const adminId = user.user?.id || user.id;
        const adminName = user.user?.name || user.name || 'Admin';
        socket.emit('join_admins', { id: adminId, name: adminName });
        console.log('[Dashboard] Admin subscribed to join_admins:', adminId);

        // ✅ Escuchar actualizaciones de ubicación en tiempo real
        socket.on('location_update', (data) => {
            console.log('[Dashboard] location_update received:', data);
            setActiveLocations(prev => ({
                ...prev,
                [data.employeeId]: { ...data, lastUpdate: new Date().toISOString() }
            }));
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
                const { data } = await api.get('/api/locations');
                const initialLocations = {};
                data.forEach(loc => {
                    initialLocations[loc.employeeId] = loc;
                });
                setActiveLocations(initialLocations);
            } catch (e) { console.error('Error fetching latest locations', e); }
        };

        fetchEmployees();
        fetchLatestLocations();

        // Detectar cambios de tamaño de pantalla
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);

        return () => {
            socket.off('location_update');
            socket.off('disconnect');
            socket.off('connect');
            disconnectSocket();
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const activeCount = Object.keys(activeLocations).length;

    // Filtrar empleados para vista "En Vivo"
    const filteredLiveLocations = Object.values(activeLocations).filter(loc => {
        const matchesSearch = loc.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              `Vendedor ${loc.employeeId}`.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = selectedStatus === 'all' || loc.state === selectedStatus;
        return matchesSearch && matchesStatus;
    });

    // Estadísticas por estado
    const statusStats = {
        'Quieto': Object.values(activeLocations).filter(l => l.state === 'Quieto' || l.state === 'SIN_MOVIMIENTO' || l.state === 'STOPPED' || l.state === 'DEEP_SLEEP').length,
        'A pie': Object.values(activeLocations).filter(l => l.state === 'A pie' || l.state === 'CAMINANDO' || l.state === 'WALKING').length,
        'Lento': Object.values(activeLocations).filter(l => l.state === 'Lento' || l.state === 'MOVIMIENTO_LENTO' || l.state === 'BATT_SAVER' || l.state === 'NO_SIGNAL').length,
        'En auto': Object.values(activeLocations).filter(l => l.state === 'En auto' || l.state === 'VEHICULO' || l.state === 'DRIVING').length,
    };

    return (
        <div className="dashboard-layout" style={{ background: '#020617' }}>
            {/* Overlay para cerrar sidebar en mobile */}
            {isMobile && sidebarOpen && (
                <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
            )}

            <aside className={`sidebar glass ${sidebarOpen ? 'open' : ''}`} style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                <header className="sidebar-header" style={{ padding: '24px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ 
                        width: '40px', height: '40px', background: 'hsl(221, 83%, 53%)', 
                        borderRadius: '10px', display: 'flex', alignItems: 'center', 
                        justifyContent: 'center', fontSize: '20px', boxShadow: '0 0 20px rgba(37, 99, 235, 0.3)'
                    }}>📍</div>
                    <div style={{ marginLeft: '12px' }}>
                        <h2 style={{ fontFamily: 'Outfit', letterSpacing: '-0.02em', fontSize: '18px' }}>Tracker Pro</h2>
                        <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{user.user?.name || user.name || 'Admin'}</span>
                    </div>
                </header>

                <nav className="sidebar-nav" style={{ padding: '20px 12px' }}>
                    <button
                        onClick={() => { setView('live'); if (isMobile) setSidebarOpen(false); }}
                        className={`transition-all ${view === 'live' ? 'active' : ''}`}
                        style={{
                            background: view === 'live' ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                            color: view === 'live' ? '#60a5fa' : '#94a3b8',
                            marginBottom: '4px'
                        }}
                    >
                        <Activity size={18} />
                        <span style={{ fontWeight: view === 'live' ? '600' : '500' }}>Mapa en Vivo</span>
                        {activeCount > 0 && <span className="badge-count" style={{ background: '#2563eb', boxShadow: '0 0 10px rgba(37,99,235,0.5)' }}>{activeCount}</span>}
                    </button>
                    <button
                        onClick={() => { setView('history'); if (isMobile) setSidebarOpen(false); }}
                        className={`transition-all ${view === 'history' ? 'active' : ''}`}
                        style={{
                            background: view === 'history' ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                            color: view === 'history' ? '#60a5fa' : '#94a3b8',
                            marginBottom: '4px'
                        }}
                    >
                        <History size={18} />
                        <span style={{ fontWeight: view === 'history' ? '600' : '500' }}>Historial</span>
                    </button>
                    <button
                        onClick={() => { setView('vendors'); if (isMobile) setSidebarOpen(false); }}
                        className={`transition-all ${view === 'vendors' ? 'active' : ''}`}
                        style={{
                            background: view === 'vendors' ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                            color: view === 'vendors' ? '#60a5fa' : '#94a3b8'
                        }}
                    >
                        <UserCog size={18} />
                        <span style={{ fontWeight: view === 'vendors' ? '600' : '500' }}>Vendedores</span>
                    </button>
                </nav>

                {view === 'history' && (
                    <div className="employee-list" style={{ padding: '0 12px' }}>
                        <h3 style={{ fontSize: '10px', color: '#475569', marginBottom: '12px', fontWeight: '700' }}><Users size={12} /> LISTA DE VENDEDORES</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {employees.map(e => (
                                <div
                                    key={e.id}
                                    className={`employee-item transition-all ${selectedEmployee?.id === e.id ? 'selected' : ''}`}
                                    onClick={() => { setSelectedEmployee(e); if (isMobile) setSidebarOpen(false); }}
                                    style={{
                                        background: selectedEmployee?.id === e.id ? 'hsl(var(--primary) / 0.2)' : 'transparent',
                                        border: '1px solid',
                                        borderColor: selectedEmployee?.id === e.id ? 'hsl(var(--primary) / 0.3)' : 'transparent',
                                        borderRadius: '10px',
                                        padding: '10px 12px'
                                    }}
                                >
                                    <span style={{ 
                                        width: '8px', height: '8px', borderRadius: '50%', 
                                        background: activeLocations[e.id] ? '#22c55e' : '#475569',
                                        boxShadow: activeLocations[e.id] ? '0 0 8px #22c55e' : 'none'
                                    }} />
                                    <span style={{ fontSize: '13.5px' }}>{e.name}</span>
                                </div>
                            ))}
                        </div>
                        {employees.length === 0 && <p className="empty-msg">Sin vendedores registrados</p>}
                    </div>
                )}

                {view === 'live' && (
                    <div className="employee-list" style={{ padding: '0 12px' }}>
                        <div style={{ 
                            padding: '8px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', 
                            border: '1px solid rgba(255,255,255,0.05)', marginBottom: '16px',
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}>
                             <span style={{ 
                                width: '8px', height: '8px', borderRadius: '50%', 
                                background: isConnected ? '#22c55e' : '#ef4444',
                                animation: isConnected ? 'pulse-green 2s infinite' : 'none'
                             }} />
                             <span style={{ fontSize: '11px', fontWeight: '600', color: isConnected ? '#22c55e' : '#ef4444' }}>
                                {isConnected ? 'SISTEMA EN LÍNEA' : 'SIN CONEXIÓN'}
                             </span>
                        </div>
                        
                        {/* Search Box */}
                        <div style={{ position: 'relative', marginBottom: '16px' }}>
                            <Search size={14} style={{ position: 'absolute', left: '12px', top: '11px', color: '#64748b' }} />
                            <input
                                type="text"
                                placeholder="Buscar vendedor..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="transition-all"
                                style={{
                                    width: '100%', padding: '10px 12px 10px 36px',
                                    border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px',
                                    background: 'rgba(255,255,255,0.03)', color: '#f1f5f9',
                                    fontSize: '13px', outline: 'none'
                                }}
                            />
                        </div>

                        {/* Status Filters - Styled properly */}
                        <div style={{ marginBottom: '16px' }}>
                            <select
                                value={selectedStatus}
                                onChange={(e) => setSelectedStatus(e.target.value)}
                                className="transition-all"
                                style={{
                                    width: '100%', padding: '10px',
                                    border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px',
                                    background: 'rgba(255,255,255,0.03)', color: '#f1f5f9',
                                    fontSize: '12px', cursor: 'pointer', outline: 'none'
                                }}
                            >
                                <option value="all">Filtro: Todos los estados</option>
                                <option value="En auto">🚙 En auto ({statusStats['En auto']})</option>
                                <option value="A pie">🚶 A pie ({statusStats['A pie']})</option>
                                <option value="Lento">🚲 Lento ({statusStats['Lento']})</option>
                                <option value="Quieto">⏸️ Detenido ({statusStats['Quieto']})</option>
                            </select>
                        </div>

                        {/* Live List */}
                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {filteredLiveLocations.length === 0 ? (
                                <p className="empty-msg" style={{ textAlign: 'center', color: '#475569' }}>{activeCount === 0 ? 'No hay rastreos activos' : 'Sin coincidencias'}</p>
                            ) : (
                                filteredLiveLocations.map(loc => (
                                    <div
                                        key={loc.employeeId}
                                        onClick={() => {
                                            setSelectedEmployee(selectedEmployee?.id === loc.employeeId ? null : { id: loc.employeeId, name: loc.name });
                                            if (isMobile) setSidebarOpen(false);
                                        }}
                                        className="transition-all"
                                        style={{
                                            padding: '12px',
                                            background: (selectedEmployee?.id === loc.employeeId && view === 'live') ? 'hsl(var(--primary) / 0.15)' : 'rgba(255,255,255,0.02)',
                                            borderRadius: '12px',
                                            cursor: 'pointer',
                                            border: '1px solid',
                                            borderColor: (selectedEmployee?.id === loc.employeeId && view === 'live') ? 'hsl(var(--primary) / 0.3)' : 'rgba(255,255,255,0.05)',
                                            position: 'relative',
                                            overflow: 'hidden'
                                        }}
                                    >
                                        {(selectedEmployee?.id === loc.employeeId && view === 'live') && (
                                            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: 'hsl(var(--primary))' }} />
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                            <div style={{ 
                                                width: '6px', height: '6px', borderRadius: '50%', 
                                                background: '#22c55e', 
                                                boxShadow: '0 0 10px #22c55e'
                                            }} />
                                            <span style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: '600', flex: 1 }}>
                                                {loc.name || `Vendedor ${loc.employeeId}`}
                                            </span>
                                            <span style={{
                                                background: (loc.state === 'En auto' || loc.state === 'VEHICULO' || loc.state === 'DRIVING') ? 'rgba(99, 102, 241, 0.15)' : (loc.state === 'A pie' || loc.state === 'CAMINANDO' || loc.state === 'WALKING') ? 'rgba(34, 197, 94, 0.15)' : (loc.state === 'Quieto' || loc.state === 'SIN_MOVIMIENTO' || loc.state === 'STOPPED' || loc.state === 'DEEP_SLEEP') ? 'rgba(148, 163, 184, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                                color: (loc.state === 'En auto' || loc.state === 'VEHICULO' || loc.state === 'DRIVING') ? '#818cf8' : (loc.state === 'A pie' || loc.state === 'CAMINANDO' || loc.state === 'WALKING') ? '#4ade80' : (loc.state === 'Quieto' || loc.state === 'SIN_MOVIMIENTO' || loc.state === 'STOPPED' || loc.state === 'DEEP_SLEEP') ? '#94a3b8' : '#fbbf24',
                                                padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase'
                                            }}>
                                                {loc.state?.replace(/_/g, ' ') || 'STOPPED'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span>⚡ {loc.speed ? (loc.speed.toFixed(1) + ' km/h') : 'Inmóvil'}</span>
                                            <span style={{ opacity: 0.3 }}>|</span>
                                            <span>🕒 {loc.lastUpdate ? new Date(loc.lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---'}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                <footer className="sidebar-footer" style={{ padding: '16px 12px', marginTop: 'auto' }}>
                    <button onClick={onLogout} className="logout-btn transition-all" style={{ 
                        opacity: 0.8, borderRadius: '10px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)',
                        color: '#ef4444', fontWeight: '600', border: '1px solid rgba(239, 68, 68, 0.2)'
                    }}>
                        <LogOut size={16} /> Salir del sistema
                    </button>
                </footer>
            </aside>

            <main className="main-content">
                {isMobile && (
                    <button className="mobile-menu-btn glass" style={{ top: '16px', left: '16px', background: 'rgba(15, 23, 42, 0.8)', padding: '10px' }} onClick={() => setSidebarOpen(!sidebarOpen)}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </button>
                )}
                {view === 'vendors' ? (
                    <Vendors />
                ) : view === 'history' ? (
                    <HistoryView user={user} />
                ) : (
                    <MapView
                        view={view}
                        selectedEmployee={selectedEmployee}
                        activeLocations={view === 'live' ? Object.fromEntries(filteredLiveLocations.map(loc => [loc.employeeId, loc])) : activeLocations}
                    />
                )}
            </main>

            <style>{`
        .dashboard-layout { display: flex; height: 100vh; overflow: hidden; font-family: 'Inter', system-ui, sans-serif; }
        
        @keyframes pulse-green {
            0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
            100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }

        /* Sidebar Glassmorphism override */
        .sidebar { 
          width: 280px; background: rgba(15, 23, 42, 0.95) !important; color: white; display: flex; 
          flex-direction: column; flex-shrink: 0; transition: all .4s cubic-bezier(0.4, 0, 0.2, 1); 
          backdrop-filter: blur(20px) !important;
        }
        
        .sidebar-nav button.active { color: white !important; }
        
        .badge-count { margin-left: auto; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; }

        .employee-item:hover { background: rgba(255,255,255,0.05); }
        .employee-item.selected { border-color: hsl(var(--primary)) !important; }

        .main-content { flex: 1; overflow: hidden; position: relative; }
        .sidebar-overlay { 
            display: block; position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
            background: rgba(0,0,0,.6); z-index: 998; backdrop-filter: blur(4px);
        }

        @media (max-width: 767px) {
          .sidebar { 
            position: fixed; left: 0; top: 0; bottom: 0; width: 280px; 
            z-index: 999; transform: translateX(-100%); 
          }
          .sidebar.open { transform: translateX(0); box-shadow: 20px 0 50px rgba(0,0,0,0.5); }
        }
      `}</style>
        </div>
    );
};

export default Dashboard;
