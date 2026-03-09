const { Server } = require('socket.io');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

let io;
const connectedEmployees = new Map(); // { employeeId: { socketId, location, timestamp } }

const initSocket = (server) => {
    io = new Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });

    io.on('connection', (socket) => {
        logger.info(`Socket connected: ${socket.id}`);

        // Admin se une a room de admins
        socket.on('admin_join', () => {
            socket.join('admins');
            logger.info(`Admin joined: ${socket.id}`);
        });

        // Empleado se une con su ID
        socket.on('employee_join', ({ employeeId, name }) => {
            socket.join(`employee:${employeeId}`);
            connectedEmployees.set(employeeId, {
                socketId: socket.id,
                name,
                location: null,
                lastUpdate: new Date()
            });
            logger.info(`Employee ${employeeId} joined`);
        });

        // 🔑 LOCATION UPDATE - Emitir a admins en tiempo real
        socket.on('location_update', (data) => {
            const { employeeId, lat, lng, speed, accuracy, timestamp } = data;
            
            if (!employeeId || !lat || !lng) {
                logger.warn('Invalid location data:', data);
                return;
            }

            // Actualizar ubicación del empleado
            if (connectedEmployees.has(employeeId)) {
                const emp = connectedEmployees.get(employeeId);
                emp.location = { lat, lng, speed, accuracy };
                emp.lastUpdate = new Date();
            }

            // 📡 Emitir a todos los admins
            io.to('admins').emit('location_update', {
                employeeId,
                lat,
                lng,
                speed: speed || 0,
                accuracy: accuracy || 0,
                timestamp: timestamp || Date.now(),
                lastUpdate: new Date().toISOString()
            });

            logger.debug(`Location update: Employee ${employeeId} at [${lat},${lng}]`);
        });

        // Obtener lista de empleados activos
        socket.on('get_active_employees', () => {
            const active = Array.from(connectedEmployees.entries()).map(([id, data]) => ({
                employeeId: id,
                name: data.name,
                ...data.location
            }));
            socket.emit('active_employees', active);
        });

        // Desconexión
        socket.on('disconnect', () => {
            // Buscar y remover empleado desconectado
            for (const [empId, data] of connectedEmployees.entries()) {
                if (data.socketId === socket.id) {
                    connectedEmployees.delete(empId);
                    io.to('admins').emit('employee_offline', { employeeId: empId });
                    logger.info(`Employee ${empId} disconnected`);
                    break;
                }
            }
            logger.info(`Socket disconnected: ${socket.id}`);
        });
    });

    return io;
};

const getIO = () => io;

const getConnectedEmployees = () => Array.from(connectedEmployees.entries()).map(([id, data]) => ({
    employeeId: id,
    name: data.name,
    lat: data.location?.lat,
    lng: data.location?.lng,
    speed: data.location?.speed,
    lastUpdate: data.lastUpdate
}));

module.exports = { initSocket, getIO, getConnectedEmployees };

