import React, { useState } from 'react';
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
        <div className="login-bg">
            <div className="login-card">
                <div className="login-icon">📍</div>
                <h1>GPS Tracking Pro</h1>
                <p className="login-sub">Panel de Administración</p>

                {error && <div className="login-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <label>
                        Correo Electrónico
                        <input
                            type="email" required autoFocus
                            value={email} onChange={e => setEmail(e.target.value)}
                            placeholder="admin@tracking.com"
                        />
                    </label>
                    <label>
                        Contraseña
                        <div className="pass-wrap">
                            <input
                                type={showPass ? 'text' : 'password'} required
                                value={password} onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                            <button type="button" className="eye-btn" onClick={() => setShowPass(!showPass)}>
                                {showPass ? '🙈' : '👁️'}
                            </button>
                        </div>
                    </label>
                    <button type="submit" className="login-btn" disabled={loading}>
                        {loading ? 'Iniciando sesión...' : 'INICIAR SESIÓN'}
                    </button>
                </form>
            </div>

            <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', system-ui, sans-serif; }
        .login-bg {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%);
        }
        .login-card {
          background: white; border-radius: 20px; padding: 48px 40px; width: 100%; max-width: 420px;
          box-shadow: 0 25px 80px rgba(0,0,0,.4);
        }
        .login-icon { font-size: 48px; text-align: center; margin-bottom: 12px; }
        h1 { text-align: center; font-size: 26px; color: #0f172a; font-weight: 800; }
        .login-sub { text-align: center; color: #64748b; font-size: 14px; margin: 4px 0 28px; }
        .login-error {
          background: #fef2f2; border: 1px solid #fecaca; color: #dc2626;
          padding: 12px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px;
        }
        form label { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; font-size: 13px; font-weight: 600; color: #374151; }
        form input {
          padding: 12px 14px; border: 1.5px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline: none;
          transition: border-color .2s;
        }
        form input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
        .pass-wrap { position: relative; }
        .pass-wrap input { width: 100%; padding-right: 44px; }
        .eye-btn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 18px; }
        .login-btn {
          width: 100%; padding: 14px; margin-top: 8px;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: 700;
          cursor: pointer; transition: opacity .2s;
        }
        .login-btn:hover:not(:disabled) { opacity: .9; }
        .login-btn:disabled { opacity: .6; cursor: default; }
      `}</style>
        </div>
    );
};

export default Login;
