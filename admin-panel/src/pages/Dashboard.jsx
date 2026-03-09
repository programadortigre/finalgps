import React, { useState, useEffect } from 'react';
import { LogOut, Users, History, Activity, UserCog } from 'lucide-react';
import MapView from '../components/MapView';
import Vendors from './Vendors';
import api from '../services/api';
import socket, { connectSocket, disconnectSocket } from '../services/socket';

const Dashboard = ({ user, onLogout }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [activeLocations, setActiveLocations] = useState({});
    const [view, setView] = useState('live'); // 'live' | 'history' | 'vendors'
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        connectSocket();
        socket.emit('join', 'admins');

        socket.on('location_update', (data) => {
            setActiveLocations(prev => ({
                ...prev,
                [data.employeeId]: { ...data, lastUpdate: new Date().toISOString() }
            }));
        });

        const fetchEmployees = async () => {
            try {
                const { data } = await api.get('/api/trips/employees');
                setEmployees(data);
            } catch (e) { console.error('Error fetching vendors', e); }
        };

        fetchEmployees();

        // Detectar cambios de tamaño de pantalla
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);

        return () => {
            socket.off('location_update');
            disconnectSocket();
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const activeCount = Object.keys(activeLocations).length;

    return (
        <div className="dashboard-layout">
            {/* Overlay para cerrar sidebar en mobile */}
            {isMobile && sidebarOpen && (
                <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
            )}

            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
                <header className="sidebar-header">
                    <div className="sidebar-logo">📍</div>
                    <div>
                        <h2>GPS Tracker</h2>
                        <span>{user.name}</span>
                    </div>
                </header>

                <nav className="sidebar-nav">
                    <button 
                        onClick={() => { setView('live'); if (isMobile) setSidebarOpen(false); }} 
                        className={view === 'live' ? 'active' : ''}
                    >
                        <Activity size={20} />
                        <span>En Vivo</span>
                        {activeCount > 0 && <span className="badge-count">{activeCount}</span>}
                    </button>
                    <button 
                        onClick={() => { setView('history'); if (isMobile) setSidebarOpen(false); }} 
                        className={view === 'history' ? 'active' : ''}
                    >
                        <History size={20} />
                        <span>Historial</span>
                    </button>
                    <button 
                        onClick={() => { setView('vendors'); if (isMobile) setSidebarOpen(false); }} 
                        className={view === 'vendors' ? 'active' : ''}
                    >
                        <UserCog size={20} />
                        <span>Vendedores</span>
                    </button>
                </nav>

                {view === 'history' && (
                    <div className="employee-list">
                        <h3><Users size={14} /> Vendedores</h3>
                        {employees.map(e => (
                            <div
                                key={e.id}
                                className={`employee-item ${selectedEmployee?.id === e.id ? 'selected' : ''}`}
                                onClick={() => { setSelectedEmployee(e); if (isMobile) setSidebarOpen(false); }}
                            >
                                <span className={`dot ${activeLocations[e.id] ? 'dot-active' : ''}`} />
                                {e.name}
                            </div>
                        ))}
                        {employees.length === 0 && <p className="empty-msg">Sin vendedores</p>}
                    </div>
                )}

                <footer className="sidebar-footer">
                    <button onClick={onLogout} className="logout-btn">
                        <LogOut size={18} /> Cerrar Sesión
                    </button>
                </footer>
            </aside>

            <main className="main-content">
                {isMobile && (
                    <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </button>
                )}
                {view === 'vendors' ? (
                    <Vendors />
                ) : (
                    <MapView
                        view={view}
                        selectedEmployee={selectedEmployee}
                        activeLocations={activeLocations}
                    />
                )}
            </main>

            <style>{`
        .dashboard-layout { display: flex; height: 100vh; overflow: hidden; font-family: 'Inter', system-ui, sans-serif; }

        /* Sidebar */
        .sidebar { width: 260px; background: #0f172a; color: white; display: flex; flex-direction: column; flex-shrink: 0; transition: all .3s ease; }
        .sidebar-header { padding: 20px 16px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; gap: 12px; }
        .sidebar-logo { font-size: 28px; }
        .sidebar-header h2 { margin: 0; font-size: 17px; font-weight: 700; color: #f1f5f9; }
        .sidebar-header span { font-size: 12px; color: #64748b; }

        /* Nav */
        .sidebar-nav { padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; }
        .sidebar-nav button {
          display: flex; align-items: center; gap: 12px; padding: 11px 12px; width: 100%;
          background: transparent; border: none; color: #94a3b8; cursor: pointer;
          border-radius: 8px; text-align: left; font-size: 14px; font-weight: 500;
          transition: background .15s, color .15s;
        }
        .sidebar-nav button.active  { background: #1e3a5f; color: #60a5fa; }
        .sidebar-nav button:hover:not(.active) { background: #1e293b; color: #e2e8f0; }
        .badge-count { margin-left: auto; background: #2563eb; color: white; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 99px; }

        /* Employee list */
        .employee-list { flex: 1; padding: 12px 10px; overflow-y: auto; }
        .employee-list h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #475569; padding: 0 4px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
        .employee-item { padding: 9px 12px; cursor: pointer; border-radius: 8px; margin-bottom: 4px; font-size: 14px; color: #cbd5e1; display: flex; align-items: center; gap: 8px; transition: background .15s; }
        .employee-item:hover   { background: #1e293b; }
        .employee-item.selected { background: #1d4ed8; color: white; }
        .dot       { width: 8px; height: 8px; border-radius: 50%; background: #475569; flex-shrink: 0; }
        .dot-active { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
        .empty-msg { font-size: 13px; color: #475569; padding: 8px 4px; }

        /* Footer */
        .sidebar-footer { padding: 16px 10px; border-top: 1px solid #1e293b; }
        .logout-btn { width: 100%; display: flex; align-items: center; gap: 10px; padding: 11px 12px; background: #7f1d1d; border: none; color: #fca5a5; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background .15s; }
        .logout-btn:hover { background: #991b1b; }

        /* Main content */
        .main-content { flex: 1; overflow: hidden; position: relative; }

        /* Mobile menu button */
        .mobile-menu-btn { display: none; position: absolute; top: 12px; left: 12px; z-index: 999; background: #0f172a; border: none; color: white; padding: 8px; border-radius: 8px; cursor: pointer; }
        .mobile-menu-btn:hover { background: #1e293b; }

        /* Sidebar Overlay */
        .sidebar-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,.5); z-index: 998; }

        /* Mobile Responsive */
        @media (max-width: 767px) {
          .dashboard-layout { flex-direction: column; }
          .sidebar { 
            position: fixed; left: 0; top: 0; bottom: 0; width: 260px; 
            z-index: 999; transform: translateX(-100%); 
          }
          .sidebar.open { transform: translateX(0); box-shadow: 2px 0 8px rgba(0,0,0,.3); }
          .mobile-menu-btn { display: flex; }
          .sidebar-overlay { display: block; }
          .main-content { padding-top: 44px; }
          .sidebar-header span { display: none; }
          .sidebar-header h2 { font-size: 16px; }
          .sidebar-logo { font-size: 24px; }
          .sidebar-nav button span:last-of-type { font-size: 13px; }
          .employee-item { font-size: 13px; padding: 8px 10px; }
          .employee-list h3 { font-size: 10px; }
        }

        @media (max-width: 480px) {
          .sidebar { width: calc(100% - 40px); max-width: 260px; }
          .sidebar-header { padding: 16px 12px; }
          .sidebar-nav { padding: 8px 8px; gap: 2px; }
          .sidebar-nav button { padding: 9px 10px; font-size: 13px; gap: 10px; }
          .sidebar-nav svg { width: 18px; height: 18px; }
          .mobile-menu-btn { width: 40px; height: 40px; padding: 8px; }
        }
      `}</style>
        </div>
    );
};

export default Dashboard;
