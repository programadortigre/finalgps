import React, { useState, useEffect } from 'react';
import { LogOut, Users, History, Activity, UserCog } from 'lucide-react';
import MapView from '../components/MapView';
import Vendors from './Vendors';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';

const Dashboard = ({ user, onLogout }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [activeLocations, setActiveLocations] = useState({});
    const [view, setView] = useState('live'); // 'live' | 'history' | 'vendors'

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
        return () => {
            socket.off('location_update');
            disconnectSocket();
        };
    }, []);

    const activeCount = Object.keys(activeLocations).length;

    return (
        <div className="dashboard-layout">
            <aside className="sidebar">
                <header className="sidebar-header">
                    <div className="sidebar-logo">📍</div>
                    <div>
                        <h2>GPS Tracker</h2>
                        <span>{user.name}</span>
                    </div>
                </header>

                <nav className="sidebar-nav">
                    <button onClick={() => setView('live')} className={view === 'live' ? 'active' : ''}>
                        <Activity size={20} />
                        <span>En Vivo</span>
                        {activeCount > 0 && <span className="badge-count">{activeCount}</span>}
                    </button>
                    <button onClick={() => setView('history')} className={view === 'history' ? 'active' : ''}>
                        <History size={20} />
                        <span>Historial</span>
                    </button>
                    <button onClick={() => setView('vendors')} className={view === 'vendors' ? 'active' : ''}>
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
                                onClick={() => setSelectedEmployee(e)}
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
        .sidebar { width: 260px; background: #0f172a; color: white; display: flex; flex-direction: column; flex-shrink: 0; }
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
      `}</style>
        </div>
    );
};

export default Dashboard;
