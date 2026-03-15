const { Server } = require('socket.io');
const Redis = require('ioredis');

let io;
let redisSub;

/**
 * Inicializar Socket.io con REDIS PUB/SUB para soporte multi-instancia
 */
const initSocket = (server) => {
    io = new Server(server, {
        cors: { 
            origin: ['http://localhost:5173', 'http://admin-panel:80', 'http://admin-panel'],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    // ✅ CONFIGURAR REDIS SUBSCRIBER
    const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
    };
    
    redisSub = new Redis(redisConfig);
    
    redisSub.subscribe('location_updates', (err) => {
        if (err) console.error('[Redis] Error subscribing to location_updates:', err.message);
        else console.log('[Redis] Subscribed to location_updates channel ✅');
    });

    redisSub.on('message', (channel, message) => {
        if (channel === 'location_updates') {
            try {
                const data = JSON.parse(message);
                // Broadcast a todos los admins conectados a ESTA instancia
                io.to('admins').emit('location_update', data);
            } catch (e) {
                console.error('[Redis] Error parsing pub/sub message:', e);
            }
        }
    });

    io.on('connection', (socket) => {
        console.log(`[Socket] User connected: ${socket.id}`);

        // ✅ Admin se suscribe a actualizaciones en tiempo real
        socket.on('join_admins', (admin) => {
            const adminId = typeof admin === 'object' ? admin.id : admin;
            socket.join('admins');
            console.log(`[Socket] Admin ${adminId} joined 'admins' room`);

            // Notificar a otros admins que uno nuevo se conectó
            io.to('admins').emit('admin_connected', {
                userId: adminId,
                timestamp: new Date(),
                message: `Admin ${adminId} connected`
            });
        });

        // ✅ Usuario se suscribe a su propio viaje
        socket.on('join_trip', (tripId) => {
            socket.join(`trip:${tripId}`);
            console.log(`[Socket] User joined trip room: trip:${tripId}`);
        });

        // Legacy join (mantener compatibilidad)
        socket.on('join', (room) => {
            socket.join(room);
            console.log(`[Socket] User joined room: ${room}`);
        });

        // Desconexión
        socket.on('disconnect', () => {
            console.log(`[Socket] User disconnected: ${socket.id}`);
        });
    });

    return io;
};

const getIO = () => io;

module.exports = { initSocket, getIO };
