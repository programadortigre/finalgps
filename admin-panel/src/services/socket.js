import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL || '';

export const socket = io(URL, {
    autoConnect: false
});

export const setSocketToken = (token) => {
    socket.auth = { token };
    // Also set in extraHeaders for some older versions or specific server configs
    if (socket.io && socket.io.opts) {
        socket.io.opts.extraHeaders = {
            ...socket.io.opts.extraHeaders,
            Authorization: `Bearer ${token}`
        };
    }
};

export const connectSocket = (token) => {
    if (token) setSocketToken(token);
    if (!socket.connected) {
        socket.connect();
    }
};

export const disconnectSocket = () => {
    if (socket.connected) {
        socket.disconnect();
    }
};
