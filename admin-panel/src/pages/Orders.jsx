import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { ShoppingCart, RefreshCw, Filter, ChevronDown, Eye, X } from 'lucide-react';

/**
 * Orders.jsx — Tablero de Pedidos
 *
 * Admin: ve todo, cambia estados.
 * Almacén: ve todo, cambia estados (mismo view, filtrado por backend).
 * Vendedor: solo sus pedidos (controlado por API).
 */

const STATUS_CONFIG = {
    pendiente:  { label: 'Pendiente',   color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' },
    en_proceso: { label: 'En Proceso',  color: 'bg-blue-500/15   text-blue-400   border-blue-500/20'   },
    listo:      { label: 'Listo 📦',    color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20' },
    entregado:  { label: 'Entregado ✅', color: 'bg-green-500/15 text-green-400  border-green-500/20'  },
    cancelado:  { label: 'Cancelado',   color: 'bg-red-500/15    text-red-400    border-red-500/20'    },
};
const STATE_FLOW = ['pendiente', 'en_proceso', 'listo', 'entregado'];

// ── Modal Detalle de pedido ────────────────────────────────────────────────────
const OrderModal = ({ orderId, onClose, onStatusChange, userRole }) => {
    const [order, setOrder]   = useState(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        api.get(`/api/orders/${orderId}`)
            .then(r => { setOrder(r.data); setLoading(false); })
            .catch(() => setLoading(false));
    }, [orderId]);

    const advance = async () => {
        const curIdx = STATE_FLOW.indexOf(order.status);
        if (curIdx === -1 || curIdx === STATE_FLOW.length - 1) return;
        const next = STATE_FLOW[curIdx + 1];
        setUpdating(true);
        try {
            await api.patch(`/api/orders/${orderId}/status`, { status: next });
            setOrder(o => ({ ...o, status: next }));
            onStatusChange(orderId, next);
        } catch (e) {
            alert(e.response?.data?.error || 'Error al actualizar estado');
        } finally {
            setUpdating(false);
        }
    };

    const cancel = async () => {
        if (!window.confirm('¿Cancelar este pedido?')) return;
        setUpdating(true);
        try {
            await api.patch(`/api/orders/${orderId}/status`, { status: 'cancelado' });
            setOrder(o => ({ ...o, status: 'cancelado' }));
            onStatusChange(orderId, 'cancelado');
        } finally {
            setUpdating(false);
        }
    };

    const statusCfg = order ? (STATUS_CONFIG[order.status] || STATUS_CONFIG.pendiente) : null;
    const nextStatus = order ? STATE_FLOW[STATE_FLOW.indexOf(order.status) + 1] : null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="glass-dark w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
                <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                    <h3 className="font-bold text-white">Pedido #{orderId}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
                </header>

                {loading ? (
                    <div className="p-10 text-center text-slate-500 animate-pulse">Cargando...</div>
                ) : !order ? (
                    <div className="p-10 text-center text-red-400">No encontrado</div>
                ) : (
                    <div className="p-6 flex flex-col gap-5 max-h-[80vh] overflow-y-auto">
                        {/* Status badge */}
                        <div className="flex items-center justify-between">
                            <span className={`px-3 py-1 rounded-full text-sm font-bold border ${statusCfg.color}`}>
                                {statusCfg.label}
                            </span>
                            <span className="text-xs text-slate-500">
                                {new Date(order.created_at).toLocaleString('es-PE')}
                            </span>
                        </div>

                        {/* Info */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                                <p className="text-slate-500 text-xs mb-1">Vendedor</p>
                                <p className="font-semibold text-white">{order.vendedor || '—'}</p>
                            </div>
                            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                                <p className="text-slate-500 text-xs mb-1">Cliente</p>
                                <p className="font-semibold text-white">{order.cliente || '—'}</p>
                            </div>
                        </div>

                        {/* Items */}
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Productos</p>
                            <div className="flex flex-col gap-2">
                                {(order.items || []).map(item => (
                                    <div key={item.id} className="flex items-center gap-3 bg-white/[0.03] rounded-xl px-4 py-2.5 border border-white/5">
                                        {item.imagen_url && (
                                            <img src={item.imagen_url} alt={item.titulo} className="w-9 h-9 rounded-lg object-cover" onError={e => e.target.style.display='none'} />
                                        )}
                                        <div className="flex-1">
                                            <p className="text-sm text-white font-medium">{item.titulo}</p>
                                            <p className="text-xs text-slate-400">{item.quantity} × S/ {parseFloat(item.price_unit).toFixed(2)}</p>
                                        </div>
                                        <p className="text-sm font-bold text-white">S/ {parseFloat(item.price_total).toFixed(2)}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Totales */}
                        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                            <div className="flex justify-between text-sm text-slate-400 mb-1">
                                <span>Sin IGV</span><span>S/ {parseFloat(order.total_sin_igv).toFixed(2)}</span>
                            </div>
                            {parseFloat(order.descuento) > 0 && (
                                <div className="flex justify-between text-sm text-red-400 mb-1">
                                    <span>Descuento</span><span>- S/ {parseFloat(order.descuento).toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex justify-between text-base font-bold text-white border-t border-white/10 pt-2 mt-1">
                                <span>Total con IGV</span><span>S/ {parseFloat(order.total_con_igv).toFixed(2)}</span>
                            </div>
                        </div>

                        {order.notas && (
                            <div className="bg-yellow-500/5 border border-yellow-500/15 rounded-xl p-3">
                                <p className="text-xs text-yellow-400 font-bold mb-1">📝 Notas</p>
                                <p className="text-sm text-slate-300">{order.notas}</p>
                            </div>
                        )}

                        {/* Acciones (Admin y Almacén) */}
                        {userRole !== 'employee' && order.status !== 'cancelado' && order.status !== 'entregado' && (
                            <div className="flex gap-3">
                                <button onClick={cancel} disabled={updating}
                                    className="flex-1 py-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 font-semibold text-sm hover:bg-red-500/20 transition-all disabled:opacity-40">
                                    Cancelar
                                </button>
                                {nextStatus && (
                                    <button onClick={advance} disabled={updating}
                                        className="flex-2 flex-grow py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-semibold text-sm transition-all disabled:opacity-40">
                                        {updating ? 'Actualizando...' : `→ Marcar como ${STATUS_CONFIG[nextStatus]?.label}`}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Tablero Principal ─────────────────────────────────────────────────────────
const Orders = ({ user }) => {
    const userRole = user?.user?.role || user?.role || 'employee';
    const [orders, setOrders]     = useState([]);
    const [loading, setLoading]   = useState(true);
    const [statusFilter, setStatus] = useState('');
    const [dateFilter, setDate]   = useState('');
    const [total, setTotal]       = useState(0);
    const [page, setPage]         = useState(1);
    const [detailId, setDetailId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page, limit: 50 });
            if (statusFilter) params.set('status', statusFilter);
            if (dateFilter)   params.set('date', dateFilter);
            const { data } = await api.get(`/api/orders?${params}`);
            setOrders(data.orders || []);
            setTotal(data.total  || 0);
        } catch (e) {
            console.error('[Orders]', e.message);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, dateFilter, page]);

    useEffect(() => { load(); }, [load]);

    const handleStatusChange = (id, newStatus) => {
        setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o));
    };

    return (
        <div className="h-full overflow-y-auto bg-dark-950 p-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500/20 border border-green-500/20 flex items-center justify-center">
                        <ShoppingCart size={20} className="text-green-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Tablero de Pedidos</h2>
                        <p className="text-xs text-slate-400">{total} pedidos en total</p>
                    </div>
                </div>
                <button onClick={load} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 transition-all">
                    <RefreshCw size={15} />
                </button>
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap gap-3 mb-5">
                <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1); }}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none">
                    <option value="">Todos los estados</option>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                    ))}
                </select>
                <input type="date" value={dateFilter} onChange={e => { setDate(e.target.value); setPage(1); }}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none" />
                {(statusFilter || dateFilter) && (
                    <button onClick={() => { setStatus(''); setDate(''); setPage(1); }}
                        className="px-3 py-2 rounded-lg bg-white/5 text-slate-400 text-sm border border-white/10 hover:bg-white/10 flex items-center gap-1 transition-all">
                        <X size={12} /> Limpiar
                    </button>
                )}
            </div>

            {/* Tabla */}
            {loading ? (
                <div className="text-center py-20 text-slate-500 animate-pulse">Cargando pedidos...</div>
            ) : orders.length === 0 ? (
                <div className="text-center py-20 text-slate-500">Sin pedidos para mostrar</div>
            ) : (
                <div className="glass-dark rounded-2xl border border-white/5 overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest">#</th>
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest">Estado</th>
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest hidden md:table-cell">Vendedor</th>
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest hidden md:table-cell">Cliente</th>
                                <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-widest">Total</th>
                                <th className="px-4 py-3 text-center text-[11px] font-bold text-slate-500 uppercase tracking-widest">Ítems</th>
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest hidden lg:table-cell">Fecha</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map(o => {
                                const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.pendiente;
                                return (
                                    <tr key={o.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                                        <td className="px-4 py-3 text-sm font-mono text-slate-400">#{o.id}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.color}`}>
                                                {cfg.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 hidden md:table-cell text-sm text-white">{o.vendedor || '—'}</td>
                                        <td className="px-4 py-3 hidden md:table-cell text-sm text-slate-300">{o.cliente || '—'}</td>
                                        <td className="px-4 py-3 text-right text-sm font-bold text-white font-mono">
                                            S/ {parseFloat(o.total_con_igv).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-center text-sm text-slate-400">{o.item_count}</td>
                                        <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                                            {new Date(o.created_at).toLocaleDateString('es-PE')}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button onClick={() => setDetailId(o.id)}
                                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                                                <Eye size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Paginación */}
            {total > 50 && (
                <div className="flex items-center justify-center gap-3 mt-5">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className="px-4 py-2 rounded-lg bg-white/5 text-slate-300 text-sm border border-white/10 hover:bg-white/10 disabled:opacity-30 transition-all">
                        ‹ Anterior
                    </button>
                    <span className="text-sm text-slate-400">Página {page} de {Math.ceil(total / 50)}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}
                        className="px-4 py-2 rounded-lg bg-white/5 text-slate-300 text-sm border border-white/10 hover:bg-white/10 disabled:opacity-30 transition-all">
                        Siguiente ›
                    </button>
                </div>
            )}

            {detailId && (
                <OrderModal
                    orderId={detailId}
                    onClose={() => setDetailId(null)}
                    onStatusChange={handleStatusChange}
                    userRole={userRole}
                />
            )}
        </div>
    );
};

export default Orders;
