import React, { useState } from 'react';
import { MapPin, Eye, EyeOff, Lock, Mail, ArrowRight } from 'lucide-react';
import api from '../services/api';

const Login = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPass, setShowPass] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setError('');
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
        <div className="login-container">
            <div className="login-glow"></div>
            <div className="login-card">
                <div className="brand-section">
                    <div className="brand-logo">
                        <MapPin size={32} color="#fff" fill="#3b82f6" />
                    </div>
                    <h1>GPS Tracking <span className="text-gradient">Pro</span></h1>
                    <p>Panel de Administración de Flota</p>
                </div>

                {error && <div className="login-error">{error}</div>}

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="input-field">
                        <label><Mail size={14} /> Correo Electrónico</label>
                        <input
                            type="email" required autoFocus
                            value={email} onChange={e => setEmail(e.target.value)}
                            placeholder="nombre@empresa.com"
                        />
                    </div>

                    <div className="input-field">
                        <label><Lock size={14} /> Contraseña</label>
                        <div className="pass-row">
                            <input
                                type={showPass ? 'text' : 'password'} required
                                value={password} onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                            <button type="button" onClick={() => setShowPass(!showPass)}>
                                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    <button type="submit" className="login-submit-btn" disabled={loading}>
                        {loading ? 'Verificando...' : (
                            <>
                                INICIAR SESIÓN <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>

                <div className="login-footer">
                    &copy; {new Date().getFullYear()} GPS para Fuerza de Ventas. Todos los derechos reservados.
                </div>
            </div>

            <style>{`
                .login-container {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #020617;
                    padding: 20px;
                    position: relative;
                    overflow: hidden;
                    font-family: 'Inter', sans-serif;
                }

                .login-glow {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 600px;
                    height: 600px;
                    background: radial-gradient(circle, rgba(37, 99, 235, 0.15) 0%, rgba(37, 99, 235, 0) 70%);
                    pointer-events: none;
                }

                .login-card {
                    width: 100%;
                    max-width: 440px;
                    background: rgba(15, 23, 42, 0.6);
                    backdrop-filter: blur(20px) saturate(180%);
                    -webkit-backdrop-filter: blur(20px) saturate(180%);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 28px;
                    padding: 48px 40px;
                    box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
                    z-index: 10;
                    animation: cardSlideUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
                }

                @keyframes cardSlideUp {
                    from { opacity: 0; transform: translateY(40px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .brand-section {
                    text-align: center;
                    margin-bottom: 40px;
                }

                .brand-logo {
                    width: 64px;
                    height: 64px;
                    background: rgba(37, 99, 235, 0.1);
                    border: 1px solid rgba(37, 99, 235, 0.2);
                    border-radius: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                    box-shadow: 0 10px 20px rgba(0,0,0,0.2);
                }

                .brand-section h1 {
                    font-family: 'Outfit', sans-serif;
                    font-size: 28px;
                    font-weight: 800;
                    color: #fff;
                    margin: 0;
                    letter-spacing: -0.02em;
                }

                .text-gradient {
                    background: linear-gradient(135deg, #60a5fa 0%, #2563eb 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .brand-section p {
                    color: #64748b;
                    font-size: 15px;
                    margin-top: 8px;
                }

                .login-error {
                    background: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.2);
                    color: #f87171;
                    padding: 14px;
                    border-radius: 12px;
                    font-size: 13px;
                    font-weight: 600;
                    margin-bottom: 24px;
                    text-align: center;
                }

                .login-form {
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                .input-field {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .input-field label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .input-field input {
                    width: 100%;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 14px;
                    padding: 14px 18px;
                    color: #fff;
                    font-size: 15px;
                    outline: none;
                    transition: all 0.2s;
                }

                .input-field input:focus {
                    background: rgba(255, 255, 255, 0.08);
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
                }

                .pass-row {
                    position: relative;
                }

                .pass-row button {
                    position: absolute;
                    right: 14px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    color: #64748b;
                    cursor: pointer;
                    transition: color 0.2s;
                }

                .pass-row button:hover {
                    color: #fff;
                }

                .login-submit-btn {
                    margin-top: 10px;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 14px;
                    padding: 16px;
                    font-size: 15px;
                    font-weight: 800;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    transition: all 0.2s;
                    box-shadow: 0 10px 20px rgba(37, 99, 235, 0.2);
                }

                .login-submit-btn:hover {
                    background: #1d4ed8;
                    transform: translateY(-2px);
                    box-shadow: 0 15px 30px rgba(37, 99, 235, 0.3);
                }

                .login-submit-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none;
                }

                .login-footer {
                    margin-top: 40px;
                    text-align: center;
                    font-size: 11px;
                    color: #475569;
                    line-height: 1.6;
                }

                @media (max-width: 480px) {
                    .login-card {
                        padding: 32px 24px;
                    }
                    .brand-section h1 {
                        font-size: 24px;
                    }
                }
            `}</style>
        </div>
    );
};

export default Login;
