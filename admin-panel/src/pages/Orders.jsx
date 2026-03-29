import React, { useState, useEffect, useCallback } from 'react';
import { ShoppingCart, Filter, RefreshCw, ChevronDown, CheckCircle, Clock, Truck, Box, XCircle } from 'lucide-react';
import api from '../services/api';

const STATUS_CONFIG = {
    pendiente:   { label: 'Pendiente',   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  icon: Clock },
    en_proceso:  { label: 'En proceso',  color: '#6366f1', bg: 'rgba(99,102,241,0.15)',  icon: Box },
    listo:       { label: 'Listo',       color: '#0ea5e9', bg: 'rgba(14,165,233,0.15)',  icon: CheckCircle },
    entregado:   { label: 'Entregado',   color: '#10b981', bg: 'rgba(16,185,129,0.15)',  icon: Truck },
    cancelado:   { label: 'Cancelado',   color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   icon: XCircle },
};

const StatusBadge = ({ status }) => {
    const cfg = STATUS_CONFIG[status] || { label: status, color: '#64748b', bg: 'rgba(100,116,139,0.15)' };
    const Icon = cfg.icon;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33`,
        }}>
            {Icon && <Icon size={12} />} {cfg.label}
        </span>
    );
};

const StatusMenu = ({ orderId, current, onUpdate }) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const transitions = {
        pendiente:  ['en_proceso', 'cancelado'],
        en_proceso: ['listo', 'cancelado'],
        listo:      ['entregado', 'cancelado'],
        entregado:  [],
        cancelado:  [],
    };

    const nextStatuses = transitions[current] || [];
    if (nextStatuses.length === 0) return <StatusBadge status={current} />;

    const handleChange = async (st) => {
        setLoading(true); setOpen(false);
        try {
            await api.patch(`/api/orders/${orderId}/status`, { status: st });
            onUpdate(orderId, st);
        } catch (e) { alert(e.response?.data?.error || 'Error al actualizar'); }
        setLoading(false);
    };

    return (
        <div style={{ position: 'relative' }}>
            <button onClick={() => setOpen(!open)} disabled={loading} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <StatusBadge status={current} />
                <ChevronDown size={14} color="#64748b" />
            </button>
            {open && (
                <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden', minWidth: 150, boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
                    {nextStatuses.map(st => (
                        <button key={st} onClick={() => handleChange(st)} style={{
                            display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left',
                            background: 'none', border: 'none', cursor: 'pointer', color: STATUS_CONFIG[st]?.color || '#e2e8f0', fontSize: 13, fontWeight: 600,
                        }}>
                            → {STATUS_CONFIG[st]?.label || st}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Detalle de Pedido (Expandible) ──────────────────────────────────────────
const OrderDetail = ({ orderId }) => {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get(`/api/orders/${orderId}`)
            .then(r => setDetail(r.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [orderId]);

    if (loading) return <div style={{ padding: '16px 24px', color: '#64748b', fontSize: 13 }}>Cargando items...</div>;
    if (!detail) return null;

    return (
        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.15)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                    <tr style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 700 }}>Producto</th>
                        <th style={{ textAlign: 'center', padding: '4px 8px', fontWeight: 700 }}>Cant.</th>
                        <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700 }}>Precio unit.</th>
                        <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700 }}>Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    {(detail.items || []).filter(Boolean).map((item, i) => (
                        <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '8px 0', color: '#e2e8f0' }}>{item.titulo || `Prod. #${item.product_id}`}</td>
                            <td style={{ textAlign: 'center', padding: '8px', color: '#94a3b8' }}>{item.quantity}</td>
                            <td style={{ textAlign: 'right', color: '#94a3b8' }}>S/ {parseFloat(item.precio_unit).toFixed(2)}</td>
                            <td style={{ textAlign: 'right', color: '#34d399', fontWeight: 700 }}>S/ {parseFloat(item.subtotal || 0).toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr>
                        <td colSpan={3} style={{ textAlign: 'right', paddingTop: 10, color: '#94a3b8', fontSize: 12 }}>Subtotal</td>
                        <td style={{ textAlign: 'right', paddingTop: 10, color: '#e2e8f0', fontWeight: 700 }}>S/ {parseFloat(detail.subtotal || 0).toFixed(2)}</td>
                    </tr>
                    {parseFloat(detail.igv_monto) > 0 && (
                        <tr>
                            <td colSpan={3} style={{ textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>IGV</td>
                            <td style={{ textAlign: 'right', color: '#fbbf24', fontWeight: 700 }}>S/ {parseFloat(detail.igv_monto).toFixed(2)}</td>
                        </tr>
                    )}
                    <tr>
                        <td colSpan={3} style={{ textAlign: 'right', paddingTop: 4, color: '#e2e8f0', fontWeight: 700 }}>TOTAL</td>
                        <td style={{ textAlign: 'right', paddingTop: 4, color: '#34d399', fontWeight: 800, fontSize: 15 }}>S/ {parseFloat(detail.total || 0).toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
            {detail.notas && <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>📝 {detail.notas}</p>}
        </div>
    );
};

// ─── Página Principal ────────────────────────────────────────────────────────
const Orders = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [expanded, setExpanded] = useState(null);
    const [filters, setFilters] = useState({ status: '', date: '', employee_id: '' });

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filters.status)      params.append('status', filters.status);
            if (filters.date)        params.append('date', filters.date);
            if (filters.employee_id) params.append('employee_id', filters.employee_id);
            params.append('limit', '100');

            const { data } = await api.get(`/api/orders?${params}`);
            setOrders(data.orders || []);
            setTotal(data.total || 0);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, [filters]);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    const handleStatusUpdate = (orderId, newStatus) => {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    };

    const statusCounts = orders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
    }, {});

    return (
        <div style={{ padding: 24, height: '100%', overflowY: 'auto', background: '#0f172a', color: '#e2e8f0' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 22, fontWeight: 800 }}>
                        <ShoppingCart size={22} color="#10b981" /> Pedidos en Ruta
                    </h2>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>{total} pedidos totales</p>
                </div>
                <button onClick={fetchOrders} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, cursor: 'pointer' }}>
                    <RefreshCw size={15} />
                </button>
            </div>

            {/* Resumen por estado */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                    <div key={key} onClick={() => setFilters(f => ({ ...f, status: f.status === key ? '' : key }))}
                        style={{
                            flex: 1, minWidth: 110, padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                            background: filters.status === key ? cfg.bg : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${filters.status === key ? cfg.color + '55' : 'rgba(255,255,255,0.07)'}`,
                            transition: 'all 0.2s',
                        }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: cfg.color }}>{statusCounts[key] || 0}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{cfg.label}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <input type="date" value={filters.date} onChange={e => setFilters(f => ({ ...f, date: e.target.value }))}
                    style={{ padding: '9px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0', fontSize: 14, outline: 'none' }} />
                <input value={filters.employee_id} onChange={e => setFilters(f => ({ ...f, employee_id: e.target.value }))}
                    placeholder="ID vendedor..." style={{ padding: '9px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0', fontSize: 14, outline: 'none', width: 140 }} />
                {(filters.status || filters.date || filters.employee_id) && (
                    <button onClick={() => setFilters({ status: '', date: '', employee_id: '' })}
                        style={{ padding: '9px 14px', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>
                        Limpiar filtros
                    </button>
                )}
            </div>

            {/* Tabla */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Cargando pedidos...</div>
                ) : orders.length === 0 ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>No se encontraron pedidos con estos filtros.</div>
                ) : (
                    orders.map(order => (
                        <React.Fragment key={order.id}>
                            <div onClick={() => setExpanded(expanded === order.id ? null : order.id)}
                                style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr 1fr 160px', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s', background: expanded === order.id ? 'rgba(99,102,241,0.06)' : 'transparent' }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#818cf8' }}>#{order.id}</div>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{order.customer_name || '—'}</div>
                                    <div style={{ fontSize: 11, color: '#64748b' }}>{order.employee_name || `Vendedor #${order.employee_id}`}</div>
                                </div>
                                <div style={{ fontSize: 13, color: '#94a3b8' }}>
                                    {new Date(order.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </div>
                                <div style={{ fontSize: 13, color: '#94a3b8' }}>{order.item_count} item{order.item_count !== 1 ? 's' : ''}</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#34d399' }}>
                                    S/ {parseFloat(order.total || 0).toFixed(2)}
                                </div>
                                <div onClick={e => e.stopPropagation()}>
                                    <StatusMenu orderId={order.id} current={order.status} onUpdate={handleStatusUpdate} />
                                </div>
                            </div>
                            {expanded === order.id && <OrderDetail orderId={order.id} />}
                        </React.Fragment>
                    ))
                )}
            </div>
        </div>
    );
};

export default Orders;
