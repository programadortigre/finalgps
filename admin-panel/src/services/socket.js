import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL || window.location.origin;

const socket = io(URL, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling']
});

socket.on('connect', () => {
    console.log('✓ Connected to socket server');
    // Unirse a admins room para recibir ubicaciones en vivo
    socket.emit('admin_join');
});

socket.on('disconnect', () => {
    console.warn('✗ Disconnected from socket server');
});

socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
});

export const connectSocket = () => {
    if (!socket.connected) {
        socket.connect();
    }
};

export const disconnectSocket = () => {
    if (socket.connected) {
        socket.disconnect();
    }
};

export default socket;
