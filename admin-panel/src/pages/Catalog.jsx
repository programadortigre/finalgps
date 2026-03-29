import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { Package, Upload, Pencil, Trash2, X, Check, RefreshCw, Search, Plus } from 'lucide-react';

/**
 * Catalog.jsx — Gestión de Catálogo de Productos
 *
 * - Listado con filtros por categoría, tipo y búsqueda libre
 * - Importación masiva de CSV/JSON WooCommerce
 * - Modal de edición de campos comerciales (precios, stock, etc)
 */

// ── Modal de Edición Comercial ────────────────────────────────────────────────
const ProductModal = ({ product, onClose, onSave }) => {
    const [form, setForm] = useState({
        titulo: product?.titulo || '',
        descripcion_corta: product?.descripcion_corta || '',
        descripcion: product?.descripcion || '',
        precio_sin_igv: product?.precio_sin_igv ?? '',
        precio_con_igv: product?.precio_con_igv ?? '',
        stock_general: product?.stock_general ?? '',
        categoria: product?.categoria || '',
        tipo_producto: product?.tipo_producto || '',
        imagen_url: product?.imagen_url || '',
        active: product?.active ?? true,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError]   = useState('');

    const handle = async (e) => {
        e.preventDefault();
        setSaving(true); setError('');
        try {
            await onSave(form);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    const field = (label, key, type = 'text', placeholder = '') => (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{label}</span>
            <input
                type={type}
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: type === 'number' ? parseFloat(e.target.value) || '' : e.target.value }))}
                placeholder={placeholder}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none placeholder-slate-600"
            />
        </label>
    );

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-dark rounded-2xl w-full max-w-lg border border-white/10 shadow-2xl overflow-hidden">
                <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                    <h3 className="font-bold text-white text-lg">
                        {product ? 'Editar Producto' : 'Nuevo Producto'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </header>

                <form onSubmit={handle} className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[75vh]">
                    {error && <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">{error}</div>}

                    {field('Título del Producto', 'titulo', 'text', 'Nombre visible para vendedores')}

                    <div className="grid grid-cols-2 gap-3">
                        {field('Precio sin IGV (S/.)', 'precio_sin_igv', 'number', '0.00')}
                        {field('Precio con IGV (S/.)', 'precio_con_igv', 'number', '0.00')}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {field('Stock General (unidades)', 'stock_general', 'number', '0')}
                        {field('Categoría', 'categoria', 'text', 'Ej: Bebidas')}
                    </div>

                    {field('Tipo de Producto', 'tipo_producto', 'text', 'simple, variable...')}
                    {field('URL de Imagen', 'imagen_url', 'url', 'https://...')}

                    {/* Preview imagen */}
                    {form.imagen_url && (
                        <img src={form.imagen_url} alt="preview" className="w-20 h-20 object-cover rounded-lg border border-white/10" onError={e => e.target.style.display='none'} />
                    )}

                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.active}
                            onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                            className="w-4 h-4 accent-primary-500"
                        />
                        <span className="text-sm text-slate-300">Producto activo (visible en APK)</span>
                    </label>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-semibold text-sm border border-white/10 transition-all">
                            Cancelar
                        </button>
                        <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                            <Check size={16} />
                            {saving ? 'Guardando...' : 'Guardar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ── Modal de Importación CSV/JSON ─────────────────────────────────────────────
const ImportModal = ({ onClose, onImport }) => {
    const [text, setText]       = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult]   = useState(null);
    const [error, setError]     = useState('');

    const handleFile = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => setText(ev.target.result);
        reader.readAsText(file);
    };

    const parseCSV = (text) => {
        // Parser RFC 4180 robusto — maneja comillas, comas y saltos de línea dentro de campos
        const parseRow = (row) => {
            const fields = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < row.length; i++) {
                const ch = row[i];
                if (ch === '"') {
                    if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
                    else { inQuotes = !inQuotes; }
                } else if (ch === ',' && !inQuotes) {
                    fields.push(current); current = '';
                } else {
                    current += ch;
                }
            }
            fields.push(current);
            return fields;
        };

        // Reconstruir líneas respetando comas dentro de comillas
        const rows = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '"') { inQ = !inQ; cur += ch; }
            else if ((ch === '\n' || ch === '\r') && !inQ) {
                if (cur.trim()) rows.push(cur);
                cur = '';
                if (ch === '\r' && text[i + 1] === '\n') i++;
            } else { cur += ch; }
        }
        if (cur.trim()) rows.push(cur);

        if (rows.length < 2) return [];
        const headers = parseRow(rows[0]).map(h => h.trim());
        return rows.slice(1).map(line => {
            const vals = parseRow(line);
            const obj = {};
            headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
            return obj;
        });
    };

    const handleImport = async () => {
        if (!text.trim()) return;
        setLoading(true); setError(''); setResult(null);
        try {
            let items;
            // Intentar JSON primero, luego CSV
            try {
                items = JSON.parse(text);
            } catch {
                items = parseCSV(text);
            }
            if (!Array.isArray(items)) items = [items];
            const res = await onImport(items);
            setResult(res);
        } catch (err) {
            setError(err.response?.data?.error || 'Error en la importación');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-dark rounded-2xl w-full max-w-lg border border-white/10 shadow-2xl">
                <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                    <h3 className="font-bold text-white text-lg flex items-center gap-2">
                        <Upload size={18} className="text-primary-400" /> Importar Productos (WooCommerce)
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20}/></button>
                </header>

                <div className="p-6 flex flex-col gap-4">
                    <div className="text-xs text-slate-400 bg-white/5 rounded-lg px-4 py-3 border border-white/5">
                        ℹ️ <strong>Solo se importarán:</strong> título, descripción, categoría, tipo, tags e imagen URL.
                        Los precios y stock se configuran manualmente después.
                    </div>

                    <input type="file" accept=".csv,.json" onChange={handleFile}
                        className="text-sm text-slate-400 file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:bg-primary-600 file:text-white file:text-xs file:font-semibold cursor-pointer" />

                    <textarea
                        rows={6}
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder="O pega aquí el contenido del CSV o JSON de WooCommerce..."
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-xs font-mono focus:ring-2 focus:ring-primary-500 outline-none resize-none placeholder-slate-600"
                    />

                    {error && <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">{error}</div>}

                    {result && (
                        <div className="text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3">
                            ✅ Importado: <strong>{result.inserted}</strong> nuevos · <strong>{result.updated}</strong> actualizados
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-semibold text-sm border border-white/10">
                            Cancelar
                        </button>
                        <button onClick={handleImport} disabled={loading || !text.trim()}
                            className="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                            <Upload size={15} />
                            {loading ? 'Importando...' : 'Importar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Catalog Principal ─────────────────────────────────────────────────────────
const Catalog = () => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [search, setSearch]     = useState('');
    const [catFilter, setCat]     = useState('');
    const [categories, setCategories] = useState([]);
    const [editTarget, setEdit]   = useState(null);
    const [showEdit, setShowEdit] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [toastMsg, setToastMsg] = useState(null);

    const toast = (msg, ok = true) => { setToastMsg({ msg, ok }); setTimeout(() => setToastMsg(null), 3000); };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: 500 });
            if (catFilter) params.set('categoria', catFilter);
            const [prodRes, catRes] = await Promise.all([
                api.get(`/api/products?${params}`),
                api.get('/api/products/categorias'),
            ]);
            setProducts(prodRes.data.products || []);
            setCategories(catRes.data.categorias || []);
        } catch (e) {
            toast('Error al cargar catálogo', false);
        } finally {
            setLoading(false);
        }
    }, [catFilter]);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (form) => {
        if (editTarget) {
            await api.put(`/api/products/${editTarget.id}`, form);
            toast('Producto actualizado ✅');
        } else {
            // Nuevo producto (sin external_id)
            await api.post('/api/products/import', [{ ...form, titulo: form.titulo }]);
            toast('Producto creado ✅');
        }
        load();
    };

    const handleDelete = async (id) => {
        if (!window.confirm('¿Desactivar este producto?')) return;
        await api.delete(`/api/products/${id}`);
        toast('Producto desactivado');
        load();
    };

    const handleImport = async (items) => {
        const { data } = await api.post('/api/products/import', items);
        toast(`Importación completada: ${data.inserted} nuevos, ${data.updated} actualizados ✅`);
        load();
        return data;
    };

    const filtered = products.filter(p => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
            p.titulo?.toLowerCase().includes(q) ||
            p.categoria?.toLowerCase().includes(q) ||
            (p.categorias || []).some(c => c.toLowerCase().includes(q))
        );
    });

    return (
        <div className="h-full overflow-y-auto bg-dark-950 p-6">
            {toastMsg && (
                <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold
                    ${toastMsg.ok ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
                    {toastMsg.msg}
                </div>
            )}

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/20 flex items-center justify-center">
                        <Package size={20} className="text-blue-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Catálogo de Productos</h2>
                        <p className="text-xs text-slate-400">{products.length} productos en total</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => { setEdit(null); setShowEdit(true); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-sm transition-all">
                        <Plus size={15} /> Nuevo
                    </button>
                    <button onClick={() => setShowImport(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-semibold text-sm border border-white/10 transition-all">
                        <Upload size={15} /> Importar CSV
                    </button>
                    <button onClick={load} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 transition-all">
                        <RefreshCw size={15} />
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap gap-3 mb-5">
                <div className="relative flex-1 min-w-[180px]">
                    <Search size={14} className="absolute left-3 top-3 text-slate-500" />
                    <input type="text" placeholder="Buscar producto..." value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none placeholder-slate-600" />
                </div>
                <select value={catFilter} onChange={e => setCat(e.target.value)}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none">
                    <option value="">Todas las Categorías</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            {/* Tabla */}
            {loading ? (
                <div className="text-center py-20 text-slate-500 animate-pulse">Cargando catálogo...</div>
            ) : (
                <div className="glass-dark rounded-2xl border border-white/5 overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest">Imagen</th>
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest">Producto</th>
                                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest hidden md:table-cell">Categoría</th>
                                <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-widest">S/ sin IGV</th>
                                <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-widest">S/ con IGV</th>
                                <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-widest">Stock</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr><td colSpan={7} className="text-center py-12 text-slate-500">Sin productos</td></tr>
                            )}
                            {filtered.map(p => (
                                <tr key={p.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                                    <td className="px-4 py-3">
                                        {p.imagen_url
                                            ? <img src={p.imagen_url} alt={p.titulo} className="w-10 h-10 rounded-lg object-cover bg-white/5 border border-white/10" onError={e => e.target.style.display='none'} />
                                            : <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-lg">📦</div>
                                        }
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className="text-sm font-semibold text-white line-clamp-1">{p.titulo}</p>
                                        {p.external_id && <p className="text-[10px] text-slate-500 font-mono">ID: {p.external_id}</p>}
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell">
                                        <div className="flex flex-wrap gap-1">
                                            {(p.categorias || (p.categoria ? [p.categoria] : [])).map(c => (
                                                <button
                                                    key={c}
                                                    onClick={() => setCat(catFilter === c ? '' : c)}
                                                    className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                                                        catFilter === c
                                                            ? 'bg-blue-500/30 text-blue-300 border-blue-400/40'
                                                            : 'bg-blue-500/10 text-blue-400 border-blue-500/15 hover:bg-blue-500/20'
                                                    }`}
                                                    title={`Filtrar por: ${c}`}
                                                >
                                                    {c}
                                                </button>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right text-sm font-mono text-slate-300">
                                        {p.precio_sin_igv > 0 ? `S/ ${parseFloat(p.precio_sin_igv).toFixed(2)}` : <span className="text-slate-600">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right text-sm font-mono text-white font-semibold">
                                        {p.precio_con_igv > 0 ? `S/ ${parseFloat(p.precio_con_igv).toFixed(2)}` : <span className="text-slate-600">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`text-sm font-bold ${p.stock_general <= 5 ? 'text-red-400' : p.stock_general <= 20 ? 'text-yellow-400' : 'text-green-400'}`}>
                                            {p.stock_general}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <button onClick={() => { setEdit(p); setShowEdit(true); }}
                                                className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-all">
                                                <Pencil size={13} />
                                            </button>
                                            <button onClick={() => handleDelete(p.id)}
                                                className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showEdit  && <ProductModal product={editTarget}  onClose={() => setShowEdit(false)}   onSave={handleSave} />}
            {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />}
        </div>
    );
};

export default Catalog;
