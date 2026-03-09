const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

// Environment configuration
try {
  dotenv.config({ path: '../.env' });
} catch (e) {
  logger.info('Running without .env file, using system env');
}

const authRoutes = require('./routes/auth');
const locationRoutes = require('./routes/locations');
const tripRoutes = require('./routes/trips');
const employeeRoutes = require('./routes/employees');
const { initSocket } = require('./socket/socket');

const app = express();
const server = http.createServer(app);

// Middlewares
app.use(cors());
app.use(express.json());

// Real-time integration
const io = initSocket(server);
app.set('socketio', io);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/employees', employeeRoutes);

// Basic health check
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

const PORT = process.env.API_PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server listening on 0.0.0.0:${PORT}`);
});
