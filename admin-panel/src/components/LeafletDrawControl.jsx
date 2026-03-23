import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';

/**
 * LeafletDrawControl Component - V2 MEJORADO
 * Integra Leaflet.Draw para dibujar polígonos en el mapa
 * 
 * CAMBIOS V2:
 * - Salida explícita de modo dibujo cuando isDrawingPerimeter = false
 * - Manejo de tecla ESC para cancelar
 * - Mejor logging y error handling
 * - Callback de exit explícito
 */
const LeafletDrawControl = ({ 
    map, 
    isDrawingPerimeter, 
    onPolygonComplete, 
    onCancelDrawing 
}) => {
    const controlRef = useRef(null);
    const drawnItemsRef = useRef(null);
    const onCompleteRef = useRef(onPolygonComplete);
    const onCancelRef = useRef(onCancelDrawing);

    // Actualizar refs cuando cambian los props
    useEffect(() => {
        onCompleteRef.current = onPolygonComplete;
    }, [onPolygonComplete]);

    useEffect(() => {
        onCancelRef.current = onCancelDrawing;
    }, [onCancelDrawing]);

    useEffect(() => {
        if (!map) return;

        // Crear FeatureGroup si no existe
        if (!drawnItemsRef.current) {
            drawnItemsRef.current = new L.FeatureGroup();
            map.addLayer(drawnItemsRef.current);
        }

        const drawnItems = drawnItemsRef.current;

        // Crear el control una sola vez
        if (!controlRef.current) {
            controlRef.current = new L.Control.Draw({
                position: 'topleft',
                draw: {
                    polygon: {
                        allowIntersection: false,
                        drawError: {
                            color: '#e1e100',
                            message: 'Las líneas no pueden intersectarse'
                        },
                        shapeOptions: {
                            color: '#6366f1',
                            fillColor: '#6366f1',
                            fillOpacity: 0.2,
                            weight: 2,
                            dashArray: '5, 5'
                        }
                    },
                    marker: {
                        icon: L.divIcon({
                            className: 'drop-pin-marker-drawing',
                            html: '<div class="pin" style="background:#6366f1;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(99,102,241,0.5)"></div>',
                            iconSize: [12, 12],
                            iconAnchor: [6, 6]
                        })
                    },
                    polyline: false,
                    rectangle: false,
                    circle: false,
                    circlemarker: false
                },
                edit: {
                    featureGroup: drawnItems,
                    poly: {
                        allowIntersection: false
                    }
                }
            });
            
            map.addControl(controlRef.current);
            console.log('[DrawControl] Control de Leaflet.Draw creado con Punto y Área');

            // MANEJADOR: Cuando se completa dibujo (Marcador o Polígono)
            const handleDrawCreated = (e) => {
                console.log('[DrawControl] Evento draw:created recibido', e.layerType);
                try {
                    const layer = e.layer;
                    const type = e.layerType;
                    
                    // Agregar a la capa de items dibujados (aunque sea temporal)
                    drawnItems.addLayer(layer);
                    
                    if (type === 'polygon') {
                        const latlngs = layer.getLatLngs()[0];
                        if (!latlngs || latlngs.length < 3) {
                            console.warn('[DrawControl] ❌ Polígono sin puntos suficientes');
                            return;
                        }

                        const coordinates = latlngs.map(point => [point.lng, point.lat]);
                        
                        // Asegurar que el polígono esté cerrado para GeoJSON
                        const first = coordinates[0];
                        const last = coordinates[coordinates.length - 1];
                        const isClosed = first[0] === last[0] && first[1] === last[1];
                        
                        const closedCoords = isClosed ? coordinates : [...coordinates, first];

                        const geojson = {
                            type: 'Polygon',
                            coordinates: [closedCoords]
                        };

                        console.log('[DrawControl] ✅ Área completada, enviando a callback');
                        if (onCompleteRef.current) onCompleteRef.current(geojson, { lat: latlngs[0].lat, lng: latlngs[0].lng });
                    } 
                    else if (type === 'marker') {
                        const { lat, lng } = layer.getLatLng();
                        console.log('[DrawControl] ✅ Punto completado, enviando a callback', { lat, lng });
                        if (onCompleteRef.current) onCompleteRef.current(null, { lat, lng });
                    }
                    
                    // Limpiar después de procesar para no dejar basura en el mapa
                    setTimeout(() => {
                        drawnItems.clearLayers();
                    }, 100);

                } catch (error) {
                    console.error('[DrawControl] ❌ Error en handleDrawCreated:', error);
                }
            };

            const handleDrawStart = () => console.log('[DrawControl] ✏️ Empezando a dibujar...');

            map.on('draw:created', handleDrawCreated);
            map.on('draw:drawstart', handleDrawStart);

            return () => {
                map.off('draw:created', handleDrawCreated);
                map.off('draw:drawstart', handleDrawStart);
            };
        }
    }, [map]); // Solo depende del map, los callbacks se leen de refs

    // Mostrar/Ocultar el control basado en el estado global
    useEffect(() => {
        if (!map || !controlRef.current) return;
        
        const container = controlRef.current.getContainer();
        if (container) {
            container.style.display = isDrawingPerimeter ? 'block' : 'none';
        }

        // Manejo de ESC
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isDrawingPerimeter) {
                console.log('[DrawControl] ESC - Cancelando');
                if (controlRef.current._toolbars.draw) {
                    controlRef.current._toolbars.draw.disable();
                }
                if (onCancelRef.current) onCancelRef.current();
            }
        };

        if (isDrawingPerimeter) {
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        }
    }, [isDrawingPerimeter, map]);

    return null;
};

export default LeafletDrawControl;
