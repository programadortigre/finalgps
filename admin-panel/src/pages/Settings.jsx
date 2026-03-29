import React, { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, RefreshCw, Save, ToggleLeft, ToggleRight, Hash, Type } from 'lucide-react';
import api from '../services/api';

// Descripción amigable y grupo por setting
const SETTING_META = {
    PEDIDOS_CALCULAR_IGV:          { label: 'Calcular IGV en Pedidos',         group: 'Impuestos',   icon: '🧾', hint: 'Agrega el IGV automáticamente al total del pedido.' },
    PEDIDOS_PORCENTAJE_IGV:        { label: '% de IGV',                        group: 'Impuestos',   icon: '📊', hint: 'Porcentaje de IGV a aplicar (ej. 18 para Perú).' },
    CATALOGO_MOSTRAR_IMAGENES:     { label: 'Mostrar Imágenes en APK',         group: 'Catálogo',    icon: '🖼️', hint: 'Si está desactivado, la APK no carga las URLs de imágenes (ahorra datos).' },
    PEDIDOS_PERMITIR_DESCUENTOS:   { label: 'Permitir Descuentos Manuales',    group: 'Pedidos',     icon: '🏷️', hint: 'El vendedor puede aplicar un descuento libre al cerrar el pedido.' },
    PEDIDOS_VER_HISTORIAL_CLIENTE: { label: 'Ver Historial del Cliente',       group: 'Pedidos',     icon: '📋', hint: 'El vendedor ve los últimos pedidos del cliente antes de vender.' },
    GEOCERCA_RADIO_METROS:         { label: 'Radio de Geocerca (metros)',       group: 'Geolocalización', icon: '📍', hint: 'Distancia en metros para autorrellenar el cliente en la APK.' },
    STOCK_MINIMO_ALERTA:           { label: 'Stock Mínimo para Alerta',        group: 'Inventario',  icon: '⚠️', hint: 'Número de unidades a partir del cual se muestra alerta de stock bajo.' },
};

const SettingRow = ({ setting_key, setting, onChange }) => {
    const meta = SETTING_META[setting_key] || { label: setting_key, group: 'General', icon: '⚙️', hint: '' };
    const { value, type } = setting;

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            gap: 16, transition: 'background 0.15s',
        }}>
            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 16 }}>{meta.icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{meta.label}</span>
                </div>
                {meta.hint && <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>{meta.hint}</p>}
            </div>

            <div style={{ flexShrink: 0 }}>
                {type === 'boolean' ? (
                    <button
                        onClick={() => onChange(setting_key, !value)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                        {value
                            ? <ToggleRight size={36} color="#10b981" />
                            : <ToggleLeft  size={36} color="#475569" />
                        }
                        <span style={{ fontSize: 12, fontWeight: 700, color: value ? '#10b981' : '#64748b', minWidth: 40 }}>
                            {value ? 'ON' : 'OFF'}
                        </span>
                    </button>
                ) : type === 'number' ? (
                    <input
                        type="number"
                        value={value}
                        onChange={e => onChange(setting_key, parseFloat(e.target.value))}
                        style={{
                            width: 90, padding: '8px 12px', textAlign: 'center',
                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 10, color: '#e2e8f0', fontSize: 15, fontWeight: 700, outline: 'none',
                        }}
                    />
                ) : (
                    <input
                        type="text"
                        value={value}
                        onChange={e => onChange(setting_key, e.target.value)}
                        style={{
                            width: 160, padding: '8px 12px',
                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 10, color: '#e2e8f0', fontSize: 14, outline: 'none',
                        }}
                    />
                )}
            </div>
        </div>
    );
};

const AppSettings = () => {
    const [settings, setSettings] = useState({});
    const [original, setOriginal] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/api/settings');
            setSettings(data);
            setOriginal(JSON.parse(JSON.stringify(data)));
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchSettings(); }, [fetchSettings]);

    const handleChange = (key, newVal) => {
        setSettings(prev => ({
            ...prev,
            [key]: { ...prev[key], value: newVal }
        }));
    };

    const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

    const handleSave = async () => {
        setSaving(true);
        try {
            const patch = {};
            for (const [key, s] of Object.entries(settings)) {
                if (JSON.stringify(s.value) !== JSON.stringify(original[key]?.value)) {
                    patch[key] = s.value;
                }
            }
            await api.patch('/api/settings', patch);
            setOriginal(JSON.parse(JSON.stringify(settings)));
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e) {
            alert(e.response?.data?.error || 'Error al guardar');
        }
        setSaving(false);
    };

    // Agrupar settings por grupo
    const groups = {};
    for (const [key, setting] of Object.entries(settings)) {
        const meta = SETTING_META[key] || { group: 'General' };
        if (!groups[meta.group]) groups[meta.group] = [];
        groups[meta.group].push({ key, setting });
    }

    return (
        <div style={{ padding: 24, height: '100%', overflowY: 'auto', background: '#0f172a', color: '#e2e8f0' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 22, fontWeight: 800 }}>
                        <SettingsIcon size={22} color="#8b5cf6" /> Configuración del Sistema
                    </h2>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
                        Todo aquí afecta la APK y el panel en tiempo real.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={fetchSettings} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, cursor: 'pointer' }}>
                        <RefreshCw size={15} />
                    </button>
                    <button onClick={handleSave} disabled={!hasChanges || saving} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px',
                        background: hasChanges ? '#8b5cf6' : 'rgba(255,255,255,0.04)',
                        color: hasChanges ? '#fff' : '#475569',
                        border: 'none', borderRadius: 10, cursor: hasChanges ? 'pointer' : 'default', fontWeight: 700, fontSize: 14, transition: 'all 0.2s',
                    }}>
                        <Save size={16} />
                        {saving ? 'Guardando...' : saved ? '✅ Guardado' : 'Guardar Cambios'}
                    </button>
                </div>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 80, color: '#64748b' }}>Cargando configuración...</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {Object.entries(groups).map(([groupName, items]) => (
                        <div key={groupName} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                            {/* Group Header */}
                            <div style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                {groupName}
                            </div>

                            {items.map(({ key, setting }) => (
                                <SettingRow key={key} setting_key={key} setting={setting} onChange={handleChange} />
                            ))}
                        </div>
                    ))}

                    {/* Audit info */}
                    <div style={{ padding: '14px 18px', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 12, fontSize: 12, color: '#818cf8' }}>
                        🔒 Todos los cambios quedan registrados en el audit log del sistema.
                    </div>
                </div>
            )}

            {hasChanges && (
                <div style={{ position: 'fixed', bottom: 24, right: 24, padding: '10px 16px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, color: '#fbbf24', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    ⚠️ Hay cambios sin guardar
                </div>
            )}
        </div>
    );
};

export default AppSettings;
