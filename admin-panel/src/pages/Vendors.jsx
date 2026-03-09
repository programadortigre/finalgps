import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, Pencil, X, Check, Eye, EyeOff } from 'lucide-react';
import api from '../services/api';

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

    useEffect(() => { fetchEmployees(); }, []);

    const handleDelete = async (id, name) => {
        if (!window.confirm(`¿Eliminar a ${name}? Esta acción borrará todos sus datos.`)) return;
        try {
            await api.delete(`/api/employees/${id}`);
            fetchEmployees();
        } catch (e) { alert(e.response?.data?.error || 'Error al eliminar'); }
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
        .btn-icon.edit   { background: #eff6ff; color: #2563eb; }
        .btn-icon.delete { background: #fef2f2; color: #dc2626; }
        .btn-icon:hover  { opacity: 0.8; }
        .btn-primary   { display: flex; align-items: center; gap: 8px; padding: 10px 18px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; }
        .btn-secondary { padding: 10px 18px; background: #f1f5f9; color: #475569; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
        .loading-state { text-align: center; padding: 60px; color: #94a3b8; }

        /* Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal-card    { background: white; border-radius: 16px; width: 100%; max-width: 440px; box-shadow: 0 20px 60px rgba(0,0,0,.15); }
        .modal-header  { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid #f1f5f9; }
        .modal-header h3 { margin: 0; font-size: 18px; color: #1e293b; }
        .modal-header button { background: none; border: none; cursor: pointer; color: #64748b; }
        .modal-body    { padding: 24px; display: flex; flex-direction: column; gap: 14px; }
        .modal-body label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: #475569; }
        .modal-body input, .modal-body select { 
          padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none;
        }
        .modal-body input:focus { border-color: #2563eb; }
        .pass-row      { display: flex; gap: 8px; }
        .pass-row input { flex: 1; }
        .pass-row button { padding: 10px 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; color: #64748b; }
        .form-error    { padding: 10px 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #dc2626; font-size: 13px; }
        .modal-footer  { display: flex; justify-content: flex-end; gap: 10px; padding-top: 8px; }
      `}</style>
        </div>
    );
};

export default Vendors;
