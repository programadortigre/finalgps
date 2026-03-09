import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import './App.css';

function App() {
    const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));

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
            <div className="app-container">
                <Routes>
                    <Route
                        path="/login"
                        element={!user ? <Login onLogin={handleLogin} /> : <Navigate to="/dashboard" />}
                    />
                    <Route
                        path="/dashboard/*"
                        element={user ? <Dashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />}
                    />
                    <Route path="/" element={<Navigate to="/dashboard" />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
