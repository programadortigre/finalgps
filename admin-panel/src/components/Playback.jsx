import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, Gauge } from 'lucide-react';
import { useMap, Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';

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

// Obtener dirección desde coordenadas (reverse geocoding)
const getAddress = async (lat, lng) => {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await response.json();
        return data.address?.road || data.address?.street || data.display_name?.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (e) {
        console.error('Geocoding error:', e);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
};

const Playback = ({ points }) => {
    const [idx, setIdx] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);   // multiplier
    const [currentAddress, setCurrentAddress] = useState('Cargando dirección...');
    const intervalRef = useRef(null);
    const total = points.length;

    useEffect(() => {
        if (!playing) { clearInterval(intervalRef.current); return; }
        intervalRef.current = setInterval(() => {
            setIdx(i => {
                if (i >= total - 1) { setPlaying(false); return i; }
                return i + 1;
            });
        }, 500 / speed);
        return () => clearInterval(intervalRef.current);
    }, [playing, speed, total]);

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

    if (!total) return null;

    const currentPoint = points[idx];
    const trailPoints = points.slice(0, idx + 1).map(p => [p.lat, p.lng]);

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
                    <button onClick={reset} title="Reiniciar"><SkipBack size={18} /></button>
                    <button className="pb-play" onClick={() => setPlaying(!playing)}>
                        {playing ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                    <span className="pb-counter">{idx + 1} / {total}</span>
                </div>
                <input
                    type="range" min={0} max={total - 1} value={idx}
                    onChange={e => { setPlaying(false); setIdx(Number(e.target.value)); }}
                    className="pb-slider"
                />
                <div className="pb-speed">
                    <Gauge size={14} />
                    {[1, 2, 5, 10].map(s => (
                        <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
                            {s}x
                        </button>
                    ))}
                </div>
                {currentPoint && (
                    <div className="pb-info">
                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>📍 {currentAddress}</div>
                        <div>{new Date(currentPoint.timestamp).toLocaleTimeString('es-PE')}
                        {currentPoint.speed != null && ` · ${(currentPoint.speed).toFixed(1)} km/h`}</div>
                    </div>
                )}
            </div>

            <style>{`
        .playback-bar {
          position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
          z-index: 1000; background: white; border-radius: 16px;
          padding: 12px 18px; box-shadow: 0 8px 30px rgba(0,0,0,.15);
          display: flex; flex-direction: column; gap: 8px; min-width: 360px;
        }
        .pb-controls { display: flex; align-items: center; gap: 10px; }
        .pb-controls button { background: #f1f5f9; border: none; border-radius: 8px; padding: 7px; cursor: pointer; display: flex; align-items: center; }
        .pb-play { background: #2563eb !important; color: white; padding: 8px !important; border-radius: 50% !important; }
        .pb-counter { font-size: 13px; color: #64748b; margin-left: 4px; }
        .pb-slider { flex: 1; accent-color: #2563eb; width: 100%; height: 6px; cursor: pointer; }
        .pb-speed { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #64748b; }
        .pb-speed button { background: #f1f5f9; border: none; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px; font-weight: 600; }
        .pb-speed button.active { background: #2563eb; color: white; }
        .pb-info { font-size: 12px; color: #475569; text-align: center; }

        /* Mobile Responsive */
        @media (max-width: 768px) {
          .playback-bar {
            bottom: 12px; padding: 10px 14px; gap: 6px; min-width: auto;
            max-width: calc(100vw - 24px); border-radius: 12px;
          }
          .pb-controls button { padding: 6px; }
          .pb-counter { font-size: 12px; }
          .pb-speed { gap: 4px; font-size: 11px; }
          .pb-speed button { padding: 2px 6px; font-size: 11px; }
          .pb-info { font-size: 11px; }
          .pb-info > div { font-size: 11px; }
        }

        @media (max-width: 480px) {
          .playback-bar {
            bottom: 8px; padding: 8px 12px; gap: 4px;
          }
          .pb-controls { gap: 8px; }
          .pb-controls button { padding: 5px; }
          .pb-controls svg { width: 16px; height: 16px; }
          .pb-play svg { width: 18px; height: 18px; }
          .pb-counter { font-size: 11px; margin-left: 3px; }
          .pb-slider { height: 8px; }
          .pb-speed { gap: 3px; font-size: 10px; }
          .pb-speed button { padding: 2px 5px; font-size: 10px; }
          .pb-speed svg { width: 12px; height: 12px; }
          .pb-info { font-size: 10px; }
          .pb-info > div { font-size: 10px; }
        }
      `}</style>
        </>
    );
};

export default Playback;
