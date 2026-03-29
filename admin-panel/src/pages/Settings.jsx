import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { Settings as SettingsIcon, ToggleLeft, ToggleRight, Save, RefreshCw } from 'lucide-react';

/**
 * Settings.jsx — Panel Maestro de Configuración del Sistema
 *
 * Permite al administrador activar/desactivar características globales
 * que se reflejan tanto en la APK como en el backend.
 */
const SETTING_LABELS = {
    IGV_ENABLED:               { label: 'Calcular IGV en pedidos',              type: 'boolean', icon: '🧾' },
    IGV_PERCENT:               { label: '% de IGV',                             type: 'number',  icon: '📊', unit: '%' },
    MOSTRAR_IMAGENES_APK:      { label: 'Mostrar imágenes en la APK',           type: 'boolean', icon: '🖼️' },
    PERMITIR_HISTORIAL_CLIENTE:{ label: 'Ver historial de pedidos del cliente', type: 'boolean', icon: '📋' },
    PERMITIR_DESCUENTOS:       { label: 'Permitir descuentos manuales',         type: 'boolean', icon: '🏷️' },
    STOCK_MINIMO_ALERTA:       { label: 'Stock mínimo para alerta (unidades)',  type: 'number',  icon: '⚠️' },
    GEOCERCA_RADIO_METROS:     { label: 'Radio de autorelleno de cliente (m)',  type: 'number',  icon: '📍' },
};

const Settings = () => {
    const [settings, setSettings] = useState({});
    const [raw, setRaw]           = useState([]);
    const [loading, setLoading]   = useState(true);
    const [saving, setSaving]     = useState(false);
    const [dirty, setDirty]       = useState({});
    const [toast, setToast]       = useState(null);

    const showToast = (msg, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3000);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/api/settings');
            setSettings(data.settings || {});
            setRaw(data.raw   || []);
            setDirty({});
        } catch (e) {
            showToast('Error al cargar configuraciones', false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
        setDirty(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        if (Object.keys(dirty).length === 0) return;
        setSaving(true);
        try {
            await api.patch('/api/settings', dirty);
            setDirty({});
            showToast('Configuraciones guardadas ✅');
        } catch (e) {
            showToast('Error al guardar', false);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-full">
            <div className="text-slate-400 text-sm animate-pulse">Cargando configuraciones...</div>
        </div>
    );

    const knownKeys  = Object.keys(SETTING_LABELS);
    const unknownRaw = raw.filter(r => !knownKeys.includes(r.key));

    return (
        <div className="h-full overflow-y-auto p-6 bg-dark-950">
            {/* Toast */}
            {toast && (
                <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold transition-all
                    ${toast.ok ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
                    {toast.msg}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/20 flex items-center justify-center">
                        <SettingsIcon size={20} className="text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Configuración del Sistema</h2>
                        <p className="text-xs text-slate-400">Los cambios aplican en tiempo real al APK y al Panel</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={load}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 transition-all"
                        title="Recargar"
                    >
                        <RefreshCw size={16} />
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || Object.keys(dirty).length === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-sm disabled:opacity-40 transition-all"
                    >
                        <Save size={15} />
                        {saving ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                </div>
            </div>

            {/* Cards de configuración */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
                {knownKeys.map(key => {
                    const meta  = SETTING_LABELS[key];
                    const value = settings[key];
                    const isDirty = key in dirty;

                    return (
                        <div key={key} className={`glass-dark rounded-2xl p-5 border transition-all duration-200
                            ${isDirty ? 'border-primary-500/40 shadow-lg shadow-primary-500/10' : 'border-white/5'}`}>
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3">
                                    <span className="text-2xl">{meta.icon}</span>
                                    <div>
                                        <p className="text-sm font-semibold text-white">{meta.label}</p>
                                        <p className="text-xs text-slate-500 font-mono mt-0.5">{key}</p>
                                    </div>
                                </div>

                                {meta.type === 'boolean' ? (
                                    <button
                                        onClick={() => handleChange(key, !value)}
                                        className="flex-shrink-0"
                                    >
                                        {value
                                            ? <ToggleRight size={36} className="text-primary-400" />
                                            : <ToggleLeft  size={36} className="text-slate-600" />
                                        }
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <input
                                            type="number"
                                            value={value ?? ''}
                                            onChange={e => handleChange(key, parseFloat(e.target.value))}
                                            className="w-20 text-right bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                                        />
                                        {meta.unit && <span className="text-xs text-slate-400">{meta.unit}</span>}
                                    </div>
                                )}
                            </div>

                            {isDirty && (
                                <div className="mt-3 text-[11px] text-primary-400 font-medium">
                                    ● Cambio pendiente de guardar
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Raw / desconocidos */}
            {unknownRaw.length > 0 && (
                <div className="mt-8 max-w-4xl mx-auto">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                        Configuraciones adicionales
                    </h3>
                    <div className="glass-dark rounded-2xl border border-white/5 overflow-hidden">
                        {unknownRaw.map(r => (
                            <div key={r.key} className="flex items-center justify-between px-5 py-3 border-b border-white/5 last:border-0">
                                <span className="text-xs font-mono text-slate-400">{r.key}</span>
                                <span className="text-xs text-white font-semibold">{r.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
