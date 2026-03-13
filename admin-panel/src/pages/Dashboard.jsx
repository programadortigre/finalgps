import React, { useState, useEffect } from 'react';
import { LogOut, Users, History, Activity, UserCog, Search, Filter, Wifi, WifiOff, X, Menu, ChevronLeft } from 'lucide-react';
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
    const [panelOpen, setPanelOpen] = useState(true);
    const [navOpen, setNavOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStatus, setSelectedStatus] = useState('all');
    const [isConnected, setIsConnected] = useState(true);

    useEffect(() => {
        connectSocket();
        setIsConnected(true);

        const adminId = user.user?.id || user.id;
        const adminName = user.user?.name || user.name || 'Admin';
        socket.emit('join_admins', { id: adminId, name: adminName });

        socket.on('location_update', (data) => {
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
                data.forEach(loc => { initialLocations[loc.employeeId] = loc; });
                setActiveLocations(initialLocations);
            } catch (e) { console.error('Error fetching latest locations', e); }
        };

        fetchEmployees();
        fetchLatestLocations();

        return () => {
            socket.off('location_update');
            socket.off('disconnect');
            socket.off('connect');
            disconnectSocket();
        };
    }, []);

    const activeCount = Object.keys(activeLocations).length;

    const filteredLiveLocations = Object.values(activeLocations).filter(loc => {
        const matchesSearch = loc.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            `Vendedor ${loc.employeeId}`.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = selectedStatus === 'all' || loc.state === selectedStatus;
        return matchesSearch && matchesStatus;
    });

    const statusStats = {
        'Quieto': Object.values(activeLocations).filter(l => l.state === 'Quieto' || l.state === 'SIN_MOVIMIENTO').length,
        'A pie': Object.values(activeLocations).filter(l => l.state === 'A pie' || l.state === 'CAMINANDO').length,
        'Lento': Object.values(activeLocations).filter(l => l.state === 'Lento' || l.state === 'MOVIMIENTO_LENTO').length,
        'En auto': Object.values(activeLocations).filter(l => l.state === 'En auto' || l.state === 'VEHICULO').length,
    };

    const getStateColor = (state) => {
        if (state === 'En auto' || state === 'VEHICULO') return { bg: '#6366f120', text: '#818cf8', border: '#6366f1' };
        if (state === 'A pie' || state === 'CAMINANDO') return { bg: '#22c55e20', text: '#4ade80', border: '#22c55e' };
        if (state === 'Lento' || state === 'MOVIMIENTO_LENTO') return { bg: '#f59e0b20', text: '#fbbf24', border: '#f59e0b' };
        return { bg: '#94a3b820', text: '#94a3b8', border: '#94a3b8' };
    };

    // For non-map views, use the classic layout
    if (view === 'vendors') {
        return (
            <div className="db-layout">
                <TopBar
                    view={view} setView={setView}
                    navOpen={navOpen} setNavOpen={setNavOpen}
                    isConnected={isConnected} activeCount={activeCount}
                    user={user} onLogout={onLogout}
                />
                <NavDrawer open={navOpen} setOpen={setNavOpen} view={view} setView={setView} activeCount={activeCount} onLogout={onLogout} user={user} />
                <div className="db-page-content"><Vendors /></div>
                <DashboardStyles />
            </div>
        );
    }

    if (view === 'history') {
        return (
            <div className="db-layout">
                <TopBar
                    view={view} setView={setView}
                    navOpen={navOpen} setNavOpen={setNavOpen}
                    isConnected={isConnected} activeCount={activeCount}
                    user={user} onLogout={onLogout}
                />
                <NavDrawer open={navOpen} setOpen={setNavOpen} view={view} setView={setView} activeCount={activeCount} onLogout={onLogout} user={user} />
                <div className="db-page-content"><HistoryView user={user} /></div>
                <DashboardStyles />
            </div>
        );
    }

    // Live view — full-screen map
    return (
        <div className="db-layout">
            {/* Top floating bar */}
            <div className="db-topbar">
                <button className="db-topbar-btn" onClick={() => setNavOpen(true)} title="Menú">
                    <Menu size={20} />
                </button>
                <div className="db-topbar-brand">
                    <span>📍</span>
                    <span className="db-topbar-title">GPS Tracker</span>
                </div>
                <div className="db-topbar-nav">
                    <button className={`db-nav-pill ${view === 'live' ? 'active' : ''}`} onClick={() => setView('live')}>
                        <Activity size={15} /> En Vivo
                        {activeCount > 0 && <span className="db-badge">{activeCount}</span>}
                    </button>
                    <button className={`db-nav-pill ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
                        <History size={15} /> Historial
                    </button>
                    <button className={`db-nav-pill ${view === 'vendors' ? 'active' : ''}`} onClick={() => setView('vendors')}>
                        <UserCog size={15} /> Vendedores
                    </button>
                </div>
                <div className="db-topbar-right">
                    <div className={`db-conn-badge ${isConnected ? 'connected' : 'disconnected'}`}>
                        {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
                        <span>{isConnected ? 'En vivo' : 'Sin señal'}</span>
                    </div>
                    <button className="db-logout-btn" onClick={onLogout} title="Cerrar sesión">
                        <LogOut size={16} />
                    </button>
                </div>
            </div>

            {/* Nav drawer overlay */}
            <NavDrawer open={navOpen} setOpen={setNavOpen} view={view} setView={setView} activeCount={activeCount} onLogout={onLogout} user={user} />

            {/* Full-screen map */}
            <div className="db-map-full">
                <MapView
                    view={view}
                    selectedEmployee={selectedEmployee}
                    activeLocations={Object.fromEntries(filteredLiveLocations.map(loc => [loc.employeeId, loc]))}
                    allLocations={activeLocations}
                />
            </div>

            {/* Floating filter panel toggle */}
            <button
                className={`db-panel-toggle ${panelOpen ? 'panel-is-open' : ''}`}
                onClick={() => setPanelOpen(!panelOpen)}
                title={panelOpen ? 'Cerrar panel' : 'Abrir panel'}
            >
                {panelOpen ? <ChevronLeft size={18} /> : <Users size={18} />}
                {!panelOpen && activeCount > 0 && <span className="db-badge">{activeCount}</span>}
            </button>

            {/* Sliding filter panel */}
            <div className={`db-side-panel ${panelOpen ? 'open' : ''}`}>
                <div className="db-panel-header">
                    <div className="db-panel-title">
                        <span style={{ color: isConnected ? '#4ade80' : '#f87171', fontSize: '10px' }}>●</span>
                        <span>{isConnected ? 'Conectado' : 'Desconectado'}</span>
                        <span className="db-panel-count">{activeCount} activos</span>
                    </div>
                    <button className="db-panel-close" onClick={() => setPanelOpen(false)}>
                        <X size={16} />
                    </button>
                </div>

                {/* Search */}
                <div className="db-search-wrap">
                    <Search size={14} className="db-search-icon" />
                    <input
                        type="text"
                        placeholder="Buscar vendedor..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="db-search-input"
                    />
                    {searchQuery && (
                        <button className="db-search-clear" onClick={() => setSearchQuery('')}><X size={12} /></button>
                    )}
                </div>

                {/* Status filter chips */}
                <div className="db-filter-chips">
                    {[
                        { value: 'all', label: 'Todos', count: activeCount, emoji: '🌐' },
                        { value: 'En auto', label: 'Auto', count: statusStats['En auto'], emoji: '🚗' },
                        { value: 'A pie', label: 'A pie', count: statusStats['A pie'], emoji: '🚶' },
                        { value: 'Lento', label: 'Lento', count: statusStats['Lento'], emoji: '🐢' },
                        { value: 'Quieto', label: 'Quieto', count: statusStats['Quieto'], emoji: '⏸️' },
                    ].map(opt => (
                        <button
                            key={opt.value}
                            className={`db-chip ${selectedStatus === opt.value ? 'active' : ''}`}
                            onClick={() => setSelectedStatus(opt.value)}
                        >
                            {opt.emoji} {opt.label}
                            <span className="db-chip-count">{opt.count}</span>
                        </button>
                    ))}
                </div>

                <div className="db-panel-subtitle">
                    {filteredLiveLocations.length} de {activeCount} mostrando
                </div>

                {/* Employee list */}
                <div className="db-emp-list">
                    {filteredLiveLocations.length === 0 ? (
                        <div className="db-empty">
                            {activeCount === 0 ? '👥 Sin empleados activos' : '🔍 Sin resultados'}
                        </div>
                    ) : (
                        filteredLiveLocations.map(loc => {
                            const colors = getStateColor(loc.state);
                            return (
                                <div
                                    key={loc.employeeId}
                                    className="db-emp-card"
                                    style={{ borderLeftColor: colors.border }}
                                    onClick={() => {
                                        setSelectedEmployee({ id: loc.employeeId, name: loc.name });
                                        setPanelOpen(false);
                                    }}
                                >
                                    <div className="db-emp-row">
                                        <span className="dot dot-active" />
                                        <span className="db-emp-name">{loc.name || `Vendedor ${loc.employeeId}`}</span>
                                        <span className="db-state-badge" style={{ background: colors.bg, color: colors.text }}>
                                            {loc.state?.replace(/_/g, ' ') || 'Desconocido'}
                                        </span>
                                    </div>
                                    <div className="db-emp-meta">
                                        📍 {loc.speed ? (loc.speed.toFixed(1) + ' km/h') : 'Detenido'}
                                        {loc.lastUpdate && (
                                            <span className="db-emp-time">
                                                · {new Date(loc.lastUpdate).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <DashboardStyles />
        </div>
    );
};

const TopBar = ({ view, setView, navOpen, setNavOpen, isConnected, activeCount, user, onLogout }) => (
    <div className="db-topbar db-topbar-fixed">
        <button className="db-topbar-btn" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
        <div className="db-topbar-brand">
            <span>📍</span>
            <span className="db-topbar-title">GPS Tracker</span>
        </div>
        <div className="db-topbar-nav">
            <button className={`db-nav-pill ${view === 'live' ? 'active' : ''}`} onClick={() => setView('live')}>
                <Activity size={15} /> En Vivo {activeCount > 0 && <span className="db-badge">{activeCount}</span>}
            </button>
            <button className={`db-nav-pill ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
                <History size={15} /> Historial
            </button>
            <button className={`db-nav-pill ${view === 'vendors' ? 'active' : ''}`} onClick={() => setView('vendors')}>
                <UserCog size={15} /> Vendedores
            </button>
        </div>
        <div className="db-topbar-right">
            <div className={`db-conn-badge ${isConnected ? 'connected' : 'disconnected'}`}>
                {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
                <span className="db-conn-label">{isConnected ? 'En vivo' : 'Sin señal'}</span>
            </div>
            <button className="db-logout-btn" onClick={onLogout}><LogOut size={16} /></button>
        </div>
    </div>
);

const NavDrawer = ({ open, setOpen, view, setView, activeCount, onLogout, user }) => (
    <>
        {open && <div className="db-overlay" onClick={() => setOpen(false)} />}
        <div className={`db-nav-drawer ${open ? 'open' : ''}`}>
            <div className="db-drawer-header">
                <div className="db-drawer-brand">
                    <span style={{ fontSize: '24px' }}>📍</span>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '16px', color: '#f1f5f9' }}>GPS Tracker</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>{user?.user?.name || user?.name || 'Admin'}</div>
                    </div>
                </div>
                <button className="db-drawer-close" onClick={() => setOpen(false)}><X size={20} /></button>
            </div>
            <div className="db-drawer-nav">
                <button className={`db-drawer-item ${view === 'live' ? 'active' : ''}`} onClick={() => { setView('live'); setOpen(false); }}>
                    <Activity size={20} /> En Vivo {activeCount > 0 && <span className="db-badge">{activeCount}</span>}
                </button>
                <button className={`db-drawer-item ${view === 'history' ? 'active' : ''}`} onClick={() => { setView('history'); setOpen(false); }}>
                    <History size={20} /> Historial
                </button>
                <button className={`db-drawer-item ${view === 'vendors' ? 'active' : ''}`} onClick={() => { setView('vendors'); setOpen(false); }}>
                    <UserCog size={20} /> Vendedores
                </button>
            </div>
            <div className="db-drawer-footer">
                <button className="db-drawer-logout" onClick={onLogout}><LogOut size={18} /> Cerrar Sesión</button>
            </div>
        </div>
    </>
);

const DashboardStyles = () => (
    <style>{`
        * { box-sizing: border-box; }
        body, html { margin: 0; padding: 0; height: 100%; }

        .db-layout {
            position: relative;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            font-family: 'Inter', system-ui, sans-serif;
            background: #0f172a;
        }

        /* ─── Full-screen map ─── */
        .db-map-full {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
        }

        /* ─── Page content (vendors/history) ─── */
        .db-page-content {
            position: absolute;
            inset: 0;
            padding-top: 60px;
            overflow-y: auto;
            z-index: 1;
            background: #f8fafc;
        }

        /* ─── Top floating bar ─── */
        .db-topbar {
            position: absolute;
            top: 12px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 100;
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(15,23,42,0.92);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 8px 14px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.4);
            white-space: nowrap;
            max-width: calc(100vw - 24px);
        }

        .db-topbar-fixed {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            transform: none;
            border-radius: 0;
            border-left: none;
            border-right: none;
            border-top: none;
            max-width: 100%;
        }

        .db-topbar-btn {
            background: rgba(255,255,255,0.07);
            border: none;
            color: #e2e8f0;
            width: 36px;
            height: 36px;
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: background 0.15s;
        }
        .db-topbar-btn:hover { background: rgba(255,255,255,0.14); }

        .db-topbar-brand {
            display: flex;
            align-items: center;
            gap: 6px;
            color: #f1f5f9;
            font-weight: 700;
            font-size: 15px;
            flex-shrink: 0;
        }

        .db-topbar-title { display: block; }

        .db-topbar-nav {
            display: flex;
            gap: 4px;
            flex: 1;
            justify-content: center;
        }

        .db-nav-pill {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 7px 13px;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 10px;
            color: #94a3b8;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s;
            white-space: nowrap;
        }
        .db-nav-pill:hover { background: rgba(255,255,255,0.07); color: #e2e8f0; }
        .db-nav-pill.active { background: #2563eb; color: white; border-color: #3b82f6; }

        .db-topbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        .db-conn-badge {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
        }
        .db-conn-badge.connected { background: rgba(34,197,94,0.15); color: #4ade80; }
        .db-conn-badge.disconnected { background: rgba(239,68,68,0.15); color: #f87171; }
        .db-conn-label { display: block; }

        .db-logout-btn {
            background: rgba(239,68,68,0.15);
            border: none;
            color: #f87171;
            width: 36px;
            height: 36px;
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s;
        }
        .db-logout-btn:hover { background: rgba(239,68,68,0.3); }

        /* ─── Badge ─── */
        .db-badge {
            background: #2563eb;
            color: white;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 999px;
            min-width: 18px;
            text-align: center;
        }
        .db-nav-pill.active .db-badge { background: rgba(255,255,255,0.25); }

        /* ─── Panel toggle button ─── */
        .db-panel-toggle {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 90;
            background: rgba(15,23,42,0.92);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.08);
            color: #e2e8f0;
            width: 44px;
            height: 44px;
            border-radius: 14px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            transition: all 0.2s;
        }
        .db-panel-toggle:hover { background: rgba(30,41,59,0.95); }
        .db-panel-toggle.panel-is-open { display: none; }

        /* ─── Sliding side panel ─── */
        .db-side-panel {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 300px;
            z-index: 80;
            background: rgba(15,23,42,0.96);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-right: 1px solid rgba(255,255,255,0.06);
            display: flex;
            flex-direction: column;
            transform: translateX(-100%);
            transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
            box-shadow: 4px 0 24px rgba(0,0,0,0.4);
        }
        .db-side-panel.open { transform: translateX(0); }

        .db-panel-header {
            padding: 16px 14px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .db-panel-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 600;
            color: #e2e8f0;
        }

        .db-panel-count {
            background: rgba(37,99,235,0.25);
            color: #93c5fd;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 999px;
        }

        .db-panel-close {
            background: rgba(255,255,255,0.07);
            border: none;
            color: #94a3b8;
            width: 28px;
            height: 28px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
        }
        .db-panel-close:hover { background: rgba(255,255,255,0.14); color: #e2e8f0; }

        /* ─── Search ─── */
        .db-search-wrap {
            position: relative;
            padding: 12px 14px;
        }
        .db-search-icon {
            position: absolute;
            left: 25px;
            top: 50%;
            transform: translateY(-50%);
            color: #475569;
            pointer-events: none;
        }
        .db-search-input {
            width: 100%;
            padding: 9px 32px 9px 32px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 10px;
            color: #e2e8f0;
            font-size: 13px;
            outline: none;
            transition: border-color 0.15s;
        }
        .db-search-input::placeholder { color: #475569; }
        .db-search-input:focus { border-color: #3b82f6; background: rgba(255,255,255,0.08); }
        .db-search-clear {
            position: absolute;
            right: 22px;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255,255,255,0.1);
            border: none;
            color: #94a3b8;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* ─── Filter chips ─── */
        .db-filter-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding: 0 14px 12px;
        }
        .db-chip {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 5px 10px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 999px;
            color: #94a3b8;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.15s;
        }
        .db-chip:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }
        .db-chip.active { background: rgba(37,99,235,0.25); border-color: #3b82f6; color: #93c5fd; }
        .db-chip-count {
            background: rgba(255,255,255,0.1);
            padding: 1px 5px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 700;
        }
        .db-chip.active .db-chip-count { background: rgba(255,255,255,0.15); }

        .db-panel-subtitle {
            padding: 0 14px 8px;
            font-size: 11px;
            color: #475569;
        }

        /* ─── Employee list ─── */
        .db-emp-list {
            flex: 1;
            overflow-y: auto;
            padding: 0 14px 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .db-emp-card {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.06);
            border-left: 3px solid #2563eb;
            border-radius: 10px;
            padding: 10px 12px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .db-emp-card:hover { background: rgba(255,255,255,0.08); transform: translateX(2px); }

        .db-emp-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }

        .db-emp-name {
            flex: 1;
            font-size: 13px;
            font-weight: 600;
            color: #e2e8f0;
        }

        .db-state-badge {
            padding: 2px 8px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 700;
            flex-shrink: 0;
        }

        .db-emp-meta {
            font-size: 11px;
            color: #64748b;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .db-emp-time { color: #475569; }

        .db-empty {
            text-align: center;
            color: #475569;
            font-size: 13px;
            padding: 32px 16px;
        }

        /* ─── Dots ─── */
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #475569; flex-shrink: 0; }
        .dot-active { background: #22c55e; box-shadow: 0 0 6px #22c55e80; }

        /* ─── Nav Drawer ─── */
        .db-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 200;
            backdrop-filter: blur(2px);
        }
        .db-nav-drawer {
            position: fixed;
            left: 0;
            top: 0;
            bottom: 0;
            width: 260px;
            z-index: 201;
            background: rgba(15,23,42,0.98);
            backdrop-filter: blur(20px);
            border-right: 1px solid rgba(255,255,255,0.06);
            display: flex;
            flex-direction: column;
            transform: translateX(-100%);
            transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
            box-shadow: 4px 0 32px rgba(0,0,0,0.5);
        }
        .db-nav-drawer.open { transform: translateX(0); }

        .db-drawer-header {
            padding: 20px 16px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .db-drawer-brand { display: flex; align-items: center; gap: 12px; }
        .db-drawer-close {
            background: rgba(255,255,255,0.07);
            border: none;
            color: #94a3b8;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .db-drawer-nav {
            flex: 1;
            padding: 12px 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .db-drawer-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
            background: transparent;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.15s;
            text-align: left;
        }
        .db-drawer-item:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
        .db-drawer-item.active { background: rgba(37,99,235,0.2); color: #60a5fa; }

        .db-drawer-footer {
            padding: 16px;
            border-top: 1px solid rgba(255,255,255,0.06);
        }
        .db-drawer-logout {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 11px 14px;
            background: rgba(239,68,68,0.12);
            border: none;
            color: #f87171;
            border-radius: 10px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.15s;
        }
        .db-drawer-logout:hover { background: rgba(239,68,68,0.25); }

        /* ─── Mobile ─── */
        @media (max-width: 640px) {
            .db-topbar-title { display: none; }
            .db-topbar-nav { display: none; }
            .db-conn-label { display: none; }
            .db-side-panel { width: 100%; border-right: none; }
            .db-topbar { border-radius: 14px; }
        }

        @media (max-width: 480px) {
            .db-topbar { padding: 7px 10px; gap: 6px; }
        }
    `}</style>
);

export default Dashboard;
