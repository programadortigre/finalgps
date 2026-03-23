import React, { useState, useEffect } from 'react';
import { X, Save, MapPin, Phone, Info, Trash2 } from 'lucide-react';

const CustomerModal = ({ isOpen, onClose, onSave, onDelete, customer, initialCoords }) => {
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        phone: '',
        lat: '',
        lng: '',
        metadata: {}
    });

    useEffect(() => {
        if (customer) {
            setFormData({
                name: customer.name || '',
                address: customer.address || '',
                phone: customer.phone || '',
                lat: customer.lat || '',
                lng: customer.lng || '',
                metadata: customer.metadata || {}
            });
        } else if (initialCoords) {
            setFormData(prev => ({
                ...prev,
                lat: initialCoords.lat,
                lng: initialCoords.lng,
                name: '',
                address: '',
                phone: ''
            }));
        }
    }, [customer, initialCoords]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-dark-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5 bg-white/5">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        {customer ? 'Editar Cliente' : 'Nuevo Cliente'}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                            <Info size={12} /> Nombre del Cliente
                        </label>
                        <input
                            required
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            placeholder="Ej. Bodega Don Lucho"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                            <MapPin size={12} /> Dirección
                        </label>
                        <input
                            required
                            type="text"
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            placeholder="Calle, Número, Distrito"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                                <Phone size={12} /> Teléfono
                            </label>
                            <input
                                type="text"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                placeholder="999..."
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                                Coordenadas
                            </label>
                            <div className="text-[10px] text-slate-400 bg-white/5 p-2 rounded-lg border border-white/5">
                                {Number(formData.lat).toFixed(6)}, {Number(formData.lng).toFixed(6)}
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-4 border-top border-white/5">
                        {customer && (
                            <button
                                type="button"
                                onClick={() => onDelete(customer.id)}
                                className="p-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-all border border-red-500/20"
                                title="Eliminar Cliente"
                            >
                                <Trash2 size={20} />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-medium transition-all"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-bold transition-all shadow-lg shadow-primary-600/20 flex items-center justify-center gap-2"
                        >
                            <Save size={18} />
                            {customer ? 'Actualizar' : 'Guardar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CustomerModal;
