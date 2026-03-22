import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, Pencil, X, Check, Eye, EyeOff, Radio, Power, PowerOff } from 'lucide-react';
import api from '../services/api';
import { socket } from '../services/socket';

const defaultForm = { name: '', email: '', password: '', role: 'employee' };

const VendorModal = ({ vendor, onClose, onSave }) => {
    const [form, setForm] = useState(vendor ? { ...vendor, password: '' } : defaultForm);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPass, setShowPass] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setError('');
        try {
            if (vendor) {
                const payload = { name: form.name, email: form.email, role: form.role };
                if (form.password) payload.password = form.password;
                await api.put(`/api/employees/${vendor.id}`, payload);
            } else {
                await api.post('/api/employees', form);
            }
            onSave();
        } catch (err) {
            setError(err.response?.data?.error || 'Error al guardar');
        }
        setLoading(false);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card" onClick={e => e.stopPropagation()}>
                <header className="modal-header">
                    <h3>{vendor ? 'Editar Vendedor' : 'Nuevo Vendedor'}</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </header>
                <form onSubmit={handleSubmit} className="modal-body">
                    {error && <div className="form-error">{error}</div>}
                    <label>Nombre<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Juan Pérez" /></label>
                    <label>Email<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="juan@empresa.com" /></label>
                    <label>
                        {vendor ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
                        <div className="pass-row">
                            <input
                                type={showPass ? 'text' : 'password'}
                                required={!vendor}
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                                placeholder={vendor ? '••••••••' : 'Mínimo 6 caracteres'}
                                minLength={form.password ? 6 : undefined}
                            />
                            <button type="button" onClick={() => setShowPass(!showPass)}>
                                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </label>
                    <label>Rol
                        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                            <option value="employee">Vendedor</option>
                            <option value="admin">Administrador</option>
                        </select>
                    </label>
                    <footer className="modal-footer">
                        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Guardando...' : <><Check size={16} /> Guardar</>}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
};

const Vendors = () => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [search, setSearch] = useState('');

    const fetchEmployees = async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/api/employees');
            setEmployees(data);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    useEffect(() => { 
        fetchEmployees(); 
        
        const handleTrackingChanged = (data) => {
            if (!data.employeeId) return;
            setEmployees(prev => prev.map(emp => 
                emp.id === data.employeeId ? { ...emp, is_tracking_enabled: data.enabled } : emp
            ));
        };

        socket.on('tracking_status_changed', handleTrackingChanged);

        return () => {
            socket.off('tracking_status_changed', handleTrackingChanged);
        };
    }, []);

    const handleDelete = async (id, name) => {
        if (!window.confirm(`¿Eliminar a ${name}? Esta acción borrará todos sus datos.`)) return;
        try {
            await api.delete(`/api/employees/${id}`);
            fetchEmployees();
        } catch (e) { alert(e.response?.data?.error || 'Error al eliminar'); }
    };

    const toggleTracking = async (id, currentStatus) => {
        try {
            await api.patch(`/api/employees/${id}/tracking`, { enabled: !currentStatus });
            setEmployees(prev => prev.map(emp => 
                emp.id === id ? { ...emp, is_tracking_enabled: !currentStatus } : emp
            ));
        } catch (e) {
            alert(e.response?.data?.error || 'Error al cambiar estado de rastreo');
        }
    };

    const openAdd = () => { setEditTarget(null); setModalOpen(true); };
    const openEdit = (v) => { setEditTarget(v); setModalOpen(true); };
    const onSave = () => { setModalOpen(false); fetchEmployees(); };

    const filtered = employees.filter(e =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.email.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="vendors-page">
            <header className="page-header">
                <div>
                    <h2><Users size={22} /> Gestión de Vendedores</h2>
                    <p>{employees.length} usuario{employees.length !== 1 ? 's' : ''} registrado{employees.length !== 1 ? 's' : ''}</p>
                </div>
                <button className="btn-primary" onClick={openAdd}>
                    <UserPlus size={18} /> Agregar Vendedor
                </button>
            </header>

            <div className="search-bar">
                <input
                    type="text"
                    placeholder="Buscar por nombre o email..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            {loading ? (
                <div className="loading-state">Cargando...</div>
            ) : (
                <div className="vendor-table-wrap">
                    <table className="vendor-table">
                        <thead>
                            <tr>
                                <th>Nombre</th>
                                <th>Email</th>
                                <th>Rol</th>
                                <th>Rastreo</th>
                                <th>Registrado</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(v => (
                                <tr key={v.id}>
                                    <td><strong>{v.name}</strong></td>
                                    <td>{v.email}</td>
                                    <td>
                                        <span className={`badge ${v.role === 'admin' ? 'badge-admin' : 'badge-employee'}`}>
                                            {v.role === 'admin' ? 'Admin' : 'Vendedor'}
                                        </span>
                                    </td>
                                    <td>
                                        <button 
                                            onClick={() => toggleTracking(v.id, v.is_tracking_enabled)}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                                                v.is_tracking_enabled 
                                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                                                    : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                                            }`}
                                        >
                                            {v.is_tracking_enabled ? <Power size={12} /> : <PowerOff size={12} />}
                                            {v.is_tracking_enabled ? 'ACTIVO' : 'INACTIVO'}
                                        </button>
                                    </td>
                                    <td>{new Date(v.created_at).toLocaleDateString('es-PE')}</td>
                                    <td className="actions-cell">
                                        <button className="btn-icon edit" onClick={() => openEdit(v)} title="Editar">
                                            <Pencil size={16} />
                                        </button>
                                        <button className="btn-icon delete" onClick={() => handleDelete(v.id, v.name)} title="Eliminar">
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>Sin resultados</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {modalOpen && (
                <VendorModal vendor={editTarget} onClose={() => setModalOpen(false)} onSave={onSave} />
            )}

            <style>{`
        .vendors-page { padding: 24px; height: 100%; overflow-y: auto; background: #f8fafc; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .page-header h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 22px; color: #1e293b; }
        .page-header p  { margin: 4px 0 0; color: #64748b; font-size: 14px; }
        .search-bar { margin-bottom: 16px; }
        .search-bar input { width: 100%; max-width: 400px; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; }
        .search-bar input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
        .vendor-table-wrap { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
        .vendor-table { width: 100%; border-collapse: collapse; }
        .vendor-table th { background: #f1f5f9; padding: 12px 16px; text-align: left; font-size: 13px; color: #475569; font-weight: 600; }
        .vendor-table td { padding: 14px 16px; border-top: 1px solid #f1f5f9; font-size: 14px; color: #334155; }
        .vendor-table tr:hover td { background: #fafbfc; }
        .badge { padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
        .badge-admin    { background: #ede9fe; color: #6d28d9; }
        .badge-employee { background: #dbeafe; color: #1d4ed8; }
        .actions-cell { display: flex; gap: 8px; }
        .btn-icon { padding: 6px; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .vendor-table th { background: rgba(255,255,255,0.03); padding: 16px 20px; text-align: left; font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; }
        .vendor-table td { padding: 18px 20px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #e2e8f0; }
        .vendor-table tr:hover td { background: rgba(255,255,255,0.02); }
        
        .badge { padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .badge-admin { background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.2); }
        .badge-employee { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); }
        
        .actions-cell { display: flex; gap: 12px; }
        .btn-icon { width: 36px; height: 36px; border: none; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .btn-icon.edit { background: rgba(59, 130, 246, 0.1); color: #60a5fa; }
        .btn-icon.delete { background: rgba(239, 68, 68, 0.1); color: #f87171; }
        .btn-icon:hover { transform: translateY(-2px); opacity: 1; }
        .btn-icon.edit:hover { background: #2563eb; color: #fff; }
        .btn-icon.delete:hover { background: #dc2626; color: #fff; }
        
        .btn-primary { 
            display: flex; align-items: center; gap: 10px; padding: 12px 24px; 
            background: #2563eb; color: white; border: none; border-radius: 12px; 
            cursor: pointer; font-size: 14px; font-weight: 700; transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(37, 99, 235, 0.3);
        }
        .btn-primary:hover { background: #1d4ed8; transform: translateY(-2px); box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4); }
        .btn-secondary { 
            padding: 12px 24px; background: rgba(255,255,255,0.05); color: #e2e8f0; 
            border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; cursor: pointer; 
            font-size: 14px; font-weight: 600; transition: all 0.2s;
        }
        .btn-secondary:hover { background: rgba(255,255,255,0.1); }
        
        .loading-state { text-align: center; padding: 100px; color: #64748b; font-size: 16px; font-weight: 500; }

        /* Modal Glassmorphism */
        .modal-overlay { 
            position: fixed; inset: 0; background: rgba(15, 23, 42, 0.8); 
            backdrop-filter: blur(8px); display: flex; align-items: center; 
            justify-content: center; z-index: 1000; animation: fadeIn 0.3s ease;
        }
        .modal-card { 
            background: rgba(30, 41, 59, 0.9); backdrop-filter: blur(20px); 
            border-radius: 24px; width: 100%; max-width: 480px; 
            border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 30px 100px rgba(0,0,0,0.5); 
            animation: slideUp 0.3s ease;
        }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 24px 32px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .modal-header h3 { margin: 0; font-size: 20px; color: #fff; font-family: 'Outfit', sans-serif; }
        .modal-header button { background: none; border: none; cursor: pointer; color: #94a3b8; transition: color 0.2s; }
        .modal-header button:hover { color: #fff; }
        .modal-body { padding: 32px; display: flex; flex-direction: column; gap: 20px; }
        .modal-body label { display: flex; flex-direction: column; gap: 8px; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .modal-body input, .modal-body select { 
            padding: 12px 16px; background: rgba(255, 255, 255, 0.05); 
            border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; 
            font-size: 14px; color: #fff; outline: none; transition: all 0.2s;
        }
        .modal-body input:focus, .modal-body select:focus { border-color: #3b82f6; background: rgba(255, 255, 255, 0.08); }
        .pass-row { display: flex; gap: 10px; }
        .pass-row input { flex: 1; }
        .pass-row button { padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; cursor: pointer; color: #94a3b8; }
        .form-error { padding: 12px 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; color: #f87171; font-size: 14px; font-weight: 500; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 12px; padding-top: 12px; }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
        </div>
    );
};

export default Vendors;
