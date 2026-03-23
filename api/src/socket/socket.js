const { Server } = require('socket.io');
const Redis = require('ioredis');

let io;
let redisSub;
let redisPub; // BUG #3 FIX: cliente reutilizable — evita crear una conexión Redis por cada evento

/**
 * Inicializar Socket.io con REDIS PUB/SUB para soporte multi-instancia
 */
const initSocket = (server) => {
    io = new Server(server, {
        pingTimeout: 60000,
        pingInterval: 25000,
        cors: { 
            origin: ['http://localhost:5173', 'http://admin-panel:80', 'http://admin-panel'],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
    };
    
    redisSub = new Redis(redisConfig);
    redisPub = new Redis(redisConfig); // BUG #3 FIX: un solo cliente para publicar, vive toda la vida del proceso
    
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

        // ✅ Empleado se une a su propia sala privada para recibir comandos (ej: activar rastreo)
        socket.on('join_employee', (employee) => {
            const employeeId = typeof employee === 'object' ? employee.id : employee;
            socket.join(`user:${employeeId}`);
            console.log(`[Socket] Employee ${employeeId} joined room 'user:${employeeId}'`);
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

        // BUG #3 FIX: reutilizar redisPub en lugar de crear cliente nuevo por evento
        socket.on('location_update', (data) => {
            console.log(`[Socket] Received real-time update from employee ${data.employeeId}`);
            redisPub.publish('location_updates', JSON.stringify(data));
        });

        // ✅ Admin solicita ubicación en tiempo real de un empleado específico
        socket.on('admin_request_location', async (data) => {
            const { employeeId, adminId } = data;
            console.log(`[Socket] Admin ${adminId} requesting location for employee ${employeeId}`);
            
            // ✅ Guardar comando en DB para polling fallback (Modo Despertar)
            const db = require('../db/postgres');
            await db.query(
                "UPDATE employees SET pending_command = 'locate' WHERE id = $1",
                [employeeId]
            );

            // Reenviar a la sala del empleado
            io.to(`user:${employeeId}`).emit('request_current_location', {
                requestedBy: adminId,
                timestamp: new Date()
            });
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
