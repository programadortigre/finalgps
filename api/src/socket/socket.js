const { Server } = require('socket.io');

let io;

/**
 * Inicializar Socket.io para actualizaciones en tiempo real
 * Sistema de salas:
 * - 'admins': reciben actualizaciones de todas las ubicaciones
 * - 'trip:{tripId}': reciben actualizaciones específicas de cada viaje
 * - 'user:{userId}': notificaciones personales
 */
const initSocket = (server) => {
    io = new Server(server, {
        cors: { 
            origin: ['http://localhost:5173', 'http://admin-panel:80', 'http://admin-panel'],
            methods: ["GET", "POST"],
            credentials: true
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
