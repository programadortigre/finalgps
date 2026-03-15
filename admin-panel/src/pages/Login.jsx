import React, { useState } from 'react';
import { MapPin, Eye, EyeOff, Lock, Mail, ArrowRight, Zap } from 'lucide-react';
import api from '../services/api';

const Login = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPass, setShowPass] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const { data } = await api.post('/api/auth/login', { email, password });
            if (data.user.role !== 'admin') {
                setError('Acceso denegado. Solo administradores pueden entrar.');
                setLoading(false);
                return;
            }
            localStorage.setItem('token', data.accessToken);
            onLogin(data);
        } catch {
            setError('Credenciales inválidas. Verifica tu email y contraseña.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full bg-dark-950 flex items-center justify-center relative overflow-hidden p-4">
            {/* Gradient background effect */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-r from-primary-500 to-blue-600 rounded-full opacity-5 blur-3xl"></div>
                <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-b from-primary-500 to-transparent opacity-3 blur-3xl"></div>
            </div>

            {/* Login Card */}
            <div className="w-full max-w-md relative z-10 animate-in fade-in-up duration-500">
                <div className="glass-dark border border-white/10 rounded-2xl p-8 md:p-10">
                    {/* Brand Section */}
                    <div className="text-center mb-10">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500/20 to-blue-600/20 border border-primary-500/20 mb-4 shadow-lg">
                            <MapPin className="w-8 h-8 text-primary-400" strokeWidth={1.5} />
                        </div>
                        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 tracking-tight">
                            GPS Tracking <span className="text-gradient">Pro</span>
                        </h1>
                        <p className="text-slate-400 text-sm">Panel de Administración de Flota</p>
                    </div>

                    {/* Error Alert */}
                    {error && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex gap-3">
                            <Zap className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                            <p className="text-red-300 text-sm font-medium">{error}</p>
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Email Field */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                                <Mail className="w-3.5 h-3.5" />
                                Correo Electrónico
                            </label>
                            <input
                                type="email"
                                required
                                autoFocus
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="nombre@empresa.com"
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent focus:bg-white/10 transition-all duration-200 text-sm"
                            />
                        </div>

                        {/* Password Field */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                                <Lock className="w-3.5 h-3.5" />
                                Contraseña
                            </label>
                            <div className="relative">
                                <input
                                    type={showPass ? 'text' : 'password'}
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent focus:bg-white/10 transition-all duration-200 text-sm pr-12"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full mt-8 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all duration-200 shadow-lg hover:shadow-primary-500/20 hover:shadow-xl"
                        >
                            {loading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    Verificando...
                                </>
                            ) : (
                                <>
                                    INICIAR SESIÓN
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Footer */}
                    <p className="text-center text-xs text-slate-500 mt-8">
                        &copy; {new Date().getFullYear()} GPS para Fuerza de Ventas. <br />
                        Todos los derechos reservados.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
