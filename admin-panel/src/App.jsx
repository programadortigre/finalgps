import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import './App.css';

function App() {
    const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
    const [darkMode, setDarkMode] = useState(() => {
        const saved = localStorage.getItem('darkMode');
        return saved ? JSON.parse(saved) : false;
    });

    // Aplicar tema al cambiar
    useEffect(() => {
        if (darkMode) {
            document.body.classList.add('dark-mode');
            document.querySelector('.app-container')?.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
            document.querySelector('.app-container')?.classList.remove('dark-mode');
        }
        localStorage.setItem('darkMode', JSON.stringify(darkMode));
    }, [darkMode]);

    const handleLogin = (userData) => {
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('token', userData.accessToken);
        setUser(userData);
    };

    const handleLogout = () => {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        setUser(null);
    };

    return (
        <Router>
            <div className={`app-container ${darkMode ? 'dark-mode' : ''}`}>
                <Routes>
                    <Route
                        path="/login"
                        element={!user ? <Login onLogin={handleLogin} /> : <Navigate to="/dashboard" />}
                    />
                    <Route
                        path="/dashboard/*"
                        element={user ? (
                            <Dashboard 
                                user={user} 
                                onLogout={handleLogout}
                                darkMode={darkMode}
                                onDarkModeToggle={() => setDarkMode(!darkMode)}
                            />
                        ) : (
                            <Navigate to="/login" />
                        )}
                    />
                    <Route path="/" element={<Navigate to="/dashboard" />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
