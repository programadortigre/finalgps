import React, { useState, useEffect, useCallback } from 'react';
import { Package, Search, Upload, Edit2, Trash2, X, Check, Plus, RefreshCw, ChevronDown, Tag } from 'lucide-react';
import api from '../services/api';

// ─── Colores de categoría ────────────────────────────────────────────────────
const catColors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
const getCatColor = (cat) => catColors[(cat?.charCodeAt(0) || 0) % catColors.length];

// ─── Modal de Edición/Creación ────────────────────────────────────────────────
const ProductModal = ({ product, onClose, onSave }) => {
    const [form, setForm] = useState(product ? {
        titulo: product.titulo || '',
        descripcion: product.descripcion || '',
        descripcion_corta: product.descripcion_corta || '',
        precio_con_igv: product.precio_con_igv || '',
        precio_sin_igv: product.precio_sin_igv || '',
        stock_general: product.stock_general ?? 0,
        categoria: product.categoria || '',
        tipo_producto: product.tipo_producto || '',
        tags: (product.tags || []).join(', '),
        imagen_url: product.imagen_url || '',
    } : {
        titulo: '', descripcion: '', descripcion_corta: '',
        precio_con_igv: '', precio_sin_igv: '', stock_general: 0,
        categoria: '', tipo_producto: '', tags: '', imagen_url: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setError('');
        try {
            const payload = {
                ...form,
                precio_con_igv: parseFloat(form.precio_con_igv) || 0,
                precio_sin_igv: parseFloat(form.precio_sin_igv) || 0,
                stock_general: parseInt(form.stock_general) || 0,
                tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
            };
            if (product) {
                await api.put(`/api/products/${product.id}`, payload);
            } else {
                // Import single as array
                await api.post('/api/products/import', [{ ...payload }]);
            }
            onSave();
        } catch (err) {
            setError(err.response?.data?.error || 'Error al guardar');
        }
        setLoading(false);
    };

    const f = (field) => ({ value: form[field], onChange: e => setForm({ ...form, [field]: e.target.value }) });

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
                <header className="modal-header">
                    <h3>{product ? 'Editar Producto' : 'Nuevo Producto'}</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </header>

                <form onSubmit={handleSubmit} className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {error && <div className="form-error" style={{ gridColumn: '1/-1' }}>{error}</div>}

                    <label style={{ gridColumn: '1/-1' }}>Título *
                        <input required {...f('titulo')} placeholder="Nombre del producto" />
                    </label>

                    <label style={{ gridColumn: '1/-1' }}>Descripción Corta
                        <input {...f('descripcion_corta')} placeholder="Resumen breve" />
                    </label>

                    <label>Precio con IGV
                        <input type="number" step="0.01" {...f('precio_con_igv')} placeholder="0.00" />
                    </label>
                    <label>Precio sin IGV
                        <input type="number" step="0.01" {...f('precio_sin_igv')} placeholder="0.00" />
                    </label>

                    <label>Stock General
                        <input type="number" {...f('stock_general')} placeholder="0" />
                    </label>
                    <label>Categoría
                        <input {...f('categoria')} placeholder="Ej: Lácteos" />
                    </label>

                    <label>Tipo de Producto
                        <input {...f('tipo_producto')} placeholder="Ej: simple, variable" />
                    </label>
                    <label>Tags (separados por coma)
                        <input {...f('tags')} placeholder="oferta, nuevo, ..." />
                    </label>

                    <label style={{ gridColumn: '1/-1' }}>URL de Imagen
                        <input type="url" {...f('imagen_url')} placeholder="https://..." />
                    </label>

                    {product && <div style={{ gridColumn: '1/-1', fontSize: 11, color: '#64748b' }}>
                        external_id: <code>{product.external_id || '—'}</code> (no editable)
                    </div>}

                    <div className="modal-footer" style={{ gridColumn: '1/-1' }}>
                        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Guardando...' : <><Check size={16} /> Guardar</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── Modal de Importación ─────────────────────────────────────────────────────
const ImportModal = ({ onClose, onImport }) => {
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const handleImport = async () => {
        setLoading(true); setError(''); setResult(null);
        try {
            const parsed = JSON.parse(text);
            const { data } = await api.post('/api/products/import', parsed);
            setResult(data);
            onImport();
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'JSON inválido');
        }
        setLoading(false);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
                <header className="modal-header">
                    <h3>📥 Importar Productos (JSON/WooCommerce)</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </header>
                <div className="modal-body">
                    <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
                        Pega el JSON exportado desde WooCommerce o tu sistema. Admite campos: <code>name/titulo, regular_price/precio_con_igv, stock_quantity, categories, tags, images</code>.
                        <br />El sistema hará <strong>upsert por external_id</strong> — actualizará si ya existe.
                    </p>
                    <textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder='[{"id": 1, "name": "Producto X", "regular_price": "10.00", "stock_quantity": 50, ...}]'
                        style={{
                            width: '100%', minHeight: 220, background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                            color: '#e2e8f0', padding: '12px 14px', fontSize: 12,
                            fontFamily: 'monospace', resize: 'vertical', outline: 'none'
                        }}
                    />
                    {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
                    {result && (
                        <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(16,185,129,0.1)', borderRadius: 10, border: '1px solid rgba(16,185,129,0.2)', fontSize: 13, color: '#34d399' }}>
                            ✅ <strong>{result.inserted}</strong> insertados · <strong>{result.updated}</strong> actualizados
                            {result.errors?.length > 0 && ` · ⚠️ ${result.errors.length} errores`}
                        </div>
                    )}
                    <div className="modal-footer">
                        <button className="btn-secondary" onClick={onClose}>Cerrar</button>
                        <button className="btn-primary" onClick={handleImport} disabled={loading || !text.trim()}>
                            {loading ? 'Importando...' : <><Upload size={16} /> Importar</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Página Principal ─────────────────────────────────────────────────────────
const Catalog = () => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState('');
    const [filterTipo, setFilterTipo] = useState('');
    const [editTarget, setEditTarget] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showImport, setShowImport] = useState(false);

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/api/products');
            setProducts(data.products || []);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    const handleDelete = async (id, title) => {
        if (!window.confirm(`¿Desactivar "${title}"?`)) return;
        try {
            await api.delete(`/api/products/${id}`);
            setProducts(prev => prev.filter(p => p.id !== id));
        } catch (e) { alert('Error al desactivar'); }
    };

    const categories = [...new Set(products.map(p => p.categoria).filter(Boolean))];
    const tipos = [...new Set(products.map(p => p.tipo_producto).filter(Boolean))];

    const filtered = products.filter(p => {
        const q = search.toLowerCase();
        const matchSearch = !q || p.titulo?.toLowerCase().includes(q) || p.descripcion_corta?.toLowerCase().includes(q) || p.tags?.some(t => t.toLowerCase().includes(q));
        const matchCat  = !filterCat  || p.categoria     === filterCat;
        const matchTipo = !filterTipo || p.tipo_producto  === filterTipo;
        return matchSearch && matchCat && matchTipo;
    });

    return (
        <div style={{ padding: 24, height: '100%', overflowY: 'auto', background: '#0f172a', color: '#e2e8f0' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 22, fontWeight: 800 }}>
                        <Package size={22} color="#6366f1" /> Catálogo de Productos
                    </h2>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>{products.length} productos · {filtered.length} visibles</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={fetchProducts} style={btnSecStyle}><RefreshCw size={15} /></button>
                    <button onClick={() => setShowImport(true)} style={btnSecStyle}><Upload size={15} /> Importar</button>
                    <button onClick={() => { setEditTarget(null); setShowModal(true); }} style={btnPriStyle}><Plus size={15} /> Nuevo</button>
                </div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                    <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: '#64748b' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, tag..." style={{ ...inputStyle, paddingLeft: 36, width: '100%' }} />
                </div>
                <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={inputStyle}>
                    <option value="">Todas las categorías</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={inputStyle}>
                    <option value="">Todos los tipos</option>
                    {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>

            {/* Grid */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: 80, color: '#64748b' }}>Cargando catálogo...</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                    {filtered.map(p => (
                        <div key={p.id} style={cardStyle}>
                            {/* Imagen */}
                            {p.imagen_url ? (
                                <div style={{ width: '100%', height: 140, overflow: 'hidden', borderRadius: 8, marginBottom: 12, background: '#1e293b' }}>
                                    <img src={p.imagen_url} alt={p.titulo}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        onError={e => { e.target.style.display = 'none'; }} />
                                </div>
                            ) : (
                                <div style={{ width: '100%', height: 80, borderRadius: 8, marginBottom: 12, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>📦</div>
                            )}

                            {/* Badge categoría */}
                            {p.categoria && (
                                <div style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: getCatColor(p.categoria) + '22', color: getCatColor(p.categoria), border: `1px solid ${getCatColor(p.categoria)}44`, marginBottom: 6 }}>
                                    {p.categoria}
                                </div>
                            )}

                            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4, lineHeight: 1.3 }}>{p.titulo}</div>
                            {p.descripcion_corta && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>{p.descripcion_corta}</div>}

                            {/* Precios */}
                            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                                <div style={{ flex: 1, background: 'rgba(16,185,129,0.08)', borderRadius: 8, padding: '6px 10px', border: '1px solid rgba(16,185,129,0.15)' }}>
                                    <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Con IGV</div>
                                    <div style={{ fontSize: 16, fontWeight: 800, color: '#34d399' }}>S/ {parseFloat(p.precio_con_igv).toFixed(2)}</div>
                                </div>
                                <div style={{ flex: 1, background: 'rgba(148,163,184,0.05)', borderRadius: 8, padding: '6px 10px', border: '1px solid rgba(148,163,184,0.1)' }}>
                                    <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Sin IGV</div>
                                    <div style={{ fontSize: 16, fontWeight: 800, color: '#cbd5e1' }}>S/ {parseFloat(p.precio_sin_igv).toFixed(2)}</div>
                                </div>
                            </div>

                            {/* Stock */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <span style={{ fontSize: 12, color: p.stock_general <= 5 ? '#ef4444' : '#64748b' }}>
                                    📦 Stock: <strong style={{ color: p.stock_general <= 5 ? '#ef4444' : '#e2e8f0' }}>{p.stock_general}</strong>
                                    {p.stock_general <= 5 && ' ⚠️'}
                                </span>
                                {p.tipo_producto && <span style={{ fontSize: 10, color: '#94a3b8', background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: 20 }}>{p.tipo_producto}</span>}
                            </div>

                            {/* Tags */}
                            {p.tags?.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                                    {p.tags.slice(0, 4).map(t => (
                                        <span key={t} style={{ fontSize: 10, background: 'rgba(99,102,241,0.12)', color: '#818cf8', padding: '2px 8px', borderRadius: 20, border: '1px solid rgba(99,102,241,0.2)' }}>
                                            #{t}
                                        </span>
                                    ))}
                                    {p.tags.length > 4 && <span style={{ fontSize: 10, color: '#64748b' }}>+{p.tags.length - 4}</span>}
                                </div>
                            )}

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => { setEditTarget(p); setShowModal(true); }}
                                    style={{ flex: 1, ...btnIconStyle, background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                                    <Edit2 size={14} /> Editar
                                </button>
                                <button onClick={() => handleDelete(p.id, p.titulo)}
                                    style={{ ...btnIconStyle, background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '8px 12px' }}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {filtered.length === 0 && !loading && (
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: '#64748b' }}>
                            Sin productos. Importa un JSON o crea uno manualmente.
                        </div>
                    )}
                </div>
            )}

            {showModal && <ProductModal product={editTarget} onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); fetchProducts(); }} />}
            {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={fetchProducts} />}

            <style>{modalStyles}</style>
        </div>
    );
};

// ─── Estilos inline ────────────────────────────────────────────────────────────
const cardStyle = {
    background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.07)',
    padding: 16, transition: 'all 0.2s', cursor: 'default',
};
const inputStyle = {
    padding: '9px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, color: '#e2e8f0', fontSize: 14, outline: 'none',
};
const btnPriStyle = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px',
    background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14,
};
const btnSecStyle = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px',
    background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, cursor: 'pointer', fontSize: 14,
};
const btnIconStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const modalStyles = `
.modal-overlay { position:fixed;inset:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:1000; }
.modal-card { background:rgba(30,41,59,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:20px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto; }
.modal-header { display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.05); }
.modal-header h3 { margin:0;font-size:18px;color:#fff;font-weight:800; }
.modal-header button { background:none;border:none;cursor:pointer;color:#94a3b8; }
.modal-body { padding:24px;display:flex;flex-direction:column;gap:16px; }
.modal-body label { display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase; }
.modal-body input,.modal-body select,.modal-body textarea { padding:10px 14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-size:14px;color:#fff;outline:none; }
.modal-body input:focus,.modal-body select:focus,.modal-body textarea:focus { border-color:#6366f1;background:rgba(99,102,241,0.06); }
.modal-footer { display:flex;justify-content:flex-end;gap:10px;padding-top:8px; }
.btn-primary { display:flex;align-items:center;gap:8px;padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:14px; }
.btn-secondary { padding:10px 20px;background:rgba(255,255,255,0.05);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-size:14px; }
.form-error { padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:10px;color:#f87171;font-size:13px; }
`;

export default Catalog;
