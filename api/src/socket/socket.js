const { Server } = require('socket.io');

let io;

const initSocket = (server) => {
    io = new Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });

    io.on('connection', (socket) => {
        socket.on('join', (room) => {
            socket.join(room);
        });
    });

    return io;
};

const getIO = () => io;

module.exports = { initSocket, getIO };
