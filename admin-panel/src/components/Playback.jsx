import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Gauge } from 'lucide-react';
import { useMap, Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import api from '../services/api';

const vendorIcon = L.divIcon({
    className: '',
    html: `<div style="background:#2563eb;border:3px solid white;border-radius:50%;width:20px;height:20px;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
});

const FlyTo = ({ position }) => {
    const map = useMap();
    useEffect(() => {
        if (position) map.setView(position, 18, { animate: true });
    }, [position]);
    return null;
};

// Obtener dirección desde coordenadas (reverse geocoding via backend)
const getAddress = async (lat, lng) => {
    try {
        const response = await api.get(`/api/geocoding/reverse?lat=${lat}&lng=${lng}`);
        return response.data.address;
    } catch (e) {
        console.error('Geocoding error:', e);
        return `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
    }
};

const Playback = ({ points }) => {
    const [idx, setIdx] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);   // multiplier
    const [currentAddress, setCurrentAddress] = useState('Cargando dirección...');
    const [loop, setLoop] = useState(false);
    const intervalRef = useRef(null);
    const total = points.length;

    useEffect(() => {
        if (!playing) { clearInterval(intervalRef.current); return; }
        intervalRef.current = setInterval(() => {
            setIdx(i => {
                if (i >= total - 1) { 
                    if (loop) return 0;
                    setPlaying(false); 
                    return i; 
                }
                return i + 1;
            });
        }, 500 / speed);
        return () => clearInterval(intervalRef.current);
    }, [playing, speed, total, loop]);

    // Cargar dirección cuando cambia el punto actual
    useEffect(() => {
        if (points[idx]) {
            const point = points[idx];
            getAddress(point.lat, point.lng).then(addr => {
                setCurrentAddress(addr);
            });
        }
    }, [idx, points]);

    const reset = () => { setPlaying(false); setIdx(0); };
    const skipForward = () => setIdx(Math.min(idx + Math.floor(total * 0.1), total - 1));
    const skipBackward = () => setIdx(Math.max(idx - Math.floor(total * 0.1), 0));

    if (!total) return null;

    const currentPoint = points[idx];
    const trailPoints = points.slice(0, idx + 1).map(p => [p.lat, p.lng]);
    const progressPercent = (idx / (total - 1)) * 100;

    return (
        <>
            {/* Trail so far */}
            {trailPoints.length > 1 && (
                <>
                    <Polyline positions={trailPoints} color="#6C63FF" weight={12} opacity={0.25} />
                    <Polyline positions={trailPoints} color="#6C63FF" weight={4} opacity={1} />
                </>
            )}
            {/* Future path (ghost) */}
            <Polyline positions={points.slice(idx).map(p => [p.lat, p.lng])} color="#94a3b8" weight={3} opacity={.4} dashArray="6,6" />

            {/* Moving marker */}
            {currentPoint && (
                <>
                    <Marker position={[currentPoint.lat, currentPoint.lng]} icon={vendorIcon} />
                    <FlyTo position={[currentPoint.lat, currentPoint.lng]} />
                </>
            )}

            {/* Playback bar */}
            <div className="playback-bar">
                <div className="pb-controls">
                    <button onClick={reset} title="Reiniciar" className="pb-btn"><SkipBack size={18} /></button>
                    <button onClick={skipBackward} title="Retroceder 10%" className="pb-btn"><SkipBack size={16} style={{ transform: 'scale(-1, 1)' }} /></button>
                    <button className="pb-play" onClick={() => setPlaying(!playing)} title={playing ? 'Pausar' : 'Reproducir'}>
                        {playing ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                    <button onClick={skipForward} title="Avanzar 10%" className="pb-btn"><SkipForward size={16} /></button>
                    <span className="pb-counter">{idx + 1} / {total}</span>
                    <button 
                        onClick={() => setLoop(!loop)} 
                        className={`pb-btn ${loop ? 'active' : ''}`}
                        title={loop ? 'Loop activado' : 'Activar loop'}
                        style={{ fontSize: '12px', fontWeight: 'bold' }}
                    >
                        🔄
                    </button>
                </div>
                <div className="pb-slider-container">
                    <input
                        type="range" min={0} max={total - 1} value={idx}
                        onChange={e => { setPlaying(false); setIdx(Number(e.target.value)); }}
                        className="pb-slider"
                    />
                    <div className="pb-progress" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="pb-speed">
                    <Gauge size={14} />
                    {[0.5, 1, 2, 5].map(s => (
                        <button key={s} className={`pb-speed-btn ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>
                            {s}x
                        </button>
                    ))}
                </div>
                {currentPoint && (
                    <div className="pb-info">
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>📍 {currentAddress}</div>
                        <div style={{ fontSize: '12px', color: '#1e293b', fontWeight: '500' }}>
                            {new Date(currentPoint.timestamp).toLocaleTimeString('es-PE')}
                            {currentPoint.speed != null && ` · ${(currentPoint.speed).toFixed(1)} km/h`}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
        .playback-bar {
          position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
          z-index: 1000; background: white; border-radius: 12px;
          padding: 12px 16px; box-shadow: 0 8px 20px rgba(0,0,0,.15);
          display: flex; flex-direction: column; gap: 10px; max-width: 90vw;
        }
        .pb-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .pb-btn { 
          background: #f1f5f9; border: none; border-radius: 6px; padding: 6px; 
          cursor: pointer; display: flex; align-items: center; color: #475569;
          transition: all .2s; 
        }
        .pb-btn:hover { background: #e2e8f0; color: #1e293b; }
        .pb-btn.active { background: #2563eb; color: white; }
        .pb-play { 
          background: #2563eb !important; color: white; padding: 8px !important; 
          border-radius: 50% !important; width: 40px !important; height: 40px !important;
          display: flex !important; align-items: center !important; justify-content: center !important;
        }
        .pb-counter { font-size: 13px; color: #64748b; margin: 0 4px; white-space: nowrap; font-weight: 600; }
        .pb-slider-container { position: relative; width: 100%; }
        .pb-slider { 
          flex: 1; accent-color: #2563eb; width: 100%; height: 6px; 
          cursor: pointer; appearance: none; -webkit-appearance: none;
          background: transparent;
        }
        .pb-slider::-webkit-slider-thumb { 
          -webkit-appearance: none; width: 14px; height: 14px; 
          border-radius: 50%; background: #2563eb; cursor: pointer;
        }
        .pb-slider::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%; 
          background: #2563eb; cursor: pointer; border: none;
        }
        .pb-progress { 
          position: absolute; height: 3px; background: #2563eb; 
          top: 50%; transform: translateY(-50%); border-radius: 99px;
          pointer-events: none; transition: width .1s;
        }
        .pb-speed { 
          display: flex; align-items: center; gap: 6px; font-size: 12px; 
          color: #64748b; justify-content: center;
        }
        .pb-speed-btn { 
          background: #f1f5f9; border: none; border-radius: 6px; 
          padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: 600;
          transition: all .2s; color: #475569;
        }
        .pb-speed-btn:hover { background: #e2e8f0; }
        .pb-speed-btn.active { background: #2563eb; color: white; }
        .pb-info { 
          font-size: 12px; color: #475569; text-align: center; 
          background: #f8fafc; padding: 8px; border-radius: 6px;
        }

        /* Mobile Responsive */
        @media (max-width: 768px) {
          .playback-bar {
            bottom: 12px; padding: 10px 12px; gap: 8px; border-radius: 10px;
          }
          .pb-controls { gap: 6px; }
          .pb-btn { padding: 5px; }
          .pb-play { width: 36px !important; height: 36px !important; }
          .pb-counter { font-size: 12px; }
          .pb-speed { gap: 4px; font-size: 11px; }
          .pb-speed-btn { padding: 3px 6px; font-size: 10px; }
          .pb-info { font-size: 11px; padding: 6px; }
        }
      `}</style>
        </>
    );
};

export default Playback;
