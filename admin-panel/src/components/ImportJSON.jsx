import React, { useState, useRef } from 'react';
import { Upload, X, FileJson, AlertCircle, CheckCircle2 } from 'lucide-react';

const ImportJSON = ({ onImport, onClose }) => {
    const [file, setFile] = useState(null);
    const [error, setError] = useState(null);
    const [preview, setPreview] = useState(null);
    const fileInputRef = useRef(null);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile && selectedFile.type === "application/json") {
            setFile(selectedFile);
            setError(null);
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    if (Array.isArray(json)) {
                        setPreview(json);
                    } else {
                        setError('El archivo debe contener un array [] de clientes.');
                    }
                } catch (err) {
                    setError('Error al leer el JSON: ' + err.message);
                }
            };
            reader.readAsText(selectedFile);
        } else {
            setError('Por favor selecciona un archivo JSON válido.');
        }
    };

    const handleUpload = () => {
        if (preview) {
            onImport(preview);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-dark-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5 bg-white/5">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <FileJson size={20} className="text-primary-400" /> Carga Masiva (JSON)
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 flex flex-col items-center justify-center space-y-4">
                    {!file ? (
                        <div 
                            onClick={() => fileInputRef.current.click()}
                            className="w-full h-48 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-primary-500/50 hover:bg-primary-500/5 transition-all group"
                        >
                            <Upload size={48} className="text-slate-500 group-hover:text-primary-500 transition-colors mb-4" />
                            <p className="text-white font-medium">Haz click para subir archivo</p>
                            <p className="text-slate-500 text-sm mt-1">Soporta: .json (array de objetos)</p>
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleFileChange} 
                                className="hidden" 
                                accept=".json" 
                            />
                        </div>
                    ) : (
                        <div className="w-full space-y-4">
                            <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/10">
                                <div className="flex items-center gap-3">
                                    <FileJson size={32} className="text-primary-400" />
                                    <div>
                                        <p className="text-white font-medium">{file.name}</p>
                                        <p className="text-slate-500 text-xs">{(file.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                </div>
                                <button onClick={() => {setFile(null); setPreview(null);}} className="text-xs text-red-400 hover:text-red-300 font-bold p-2">Cambiar</button>
                            </div>

                            {error && (
                                <div className="flex items-center gap-3 bg-red-500/10 p-3 rounded-lg border border-red-500/20 text-red-400 text-sm">
                                    <AlertCircle size={18} /> {error}
                                </div>
                            )}

                            {preview && (
                                <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/20 text-green-400 text-sm flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 size={18} /> Se encontraron {preview.length} clientes.
                                    </div>
                                </div>
                            )}

                            {preview && (
                                <div className="max-h-40 overflow-y-auto bg-black/20 p-3 rounded-lg text-[11px] text-slate-400 font-mono">
                                    <pre>{JSON.stringify(preview.slice(0, 3), null, 2)}...</pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="p-4 bg-white/5 border-t border-white/5 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-medium transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        disabled={!preview}
                        onClick={handleUpload}
                        className={`flex-1 px-4 py-2.5 rounded-lg font-bold transition-all flex items-center justify-center gap-2 ${
                            preview ? 'bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-600/20' : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <Upload size={18} /> Importar Ahora
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImportJSON;
