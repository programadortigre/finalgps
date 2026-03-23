const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const pino = require('pino');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
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
const geocodingRoutes = require('./routes/geocoding');
const routeAssignmentRoutes = require('./routes/routes');
const customerRoutes = require('./routes/customers');
const { initSocket } = require('./socket/socket');

const app = express();
const server = http.createServer(app);

/// ============================================================================
/// MIDDLEWARE: Compresión GZIP
/// ============================================================================
/// Reduce tamaño de respuestas JSON en 75-85%
/// Ejemplo: 238 KB → 57 KB (tamaño transmitido)
app.use(compression());

/// ============================================================================
/// MIDDLEWARE: Rate Limiting
/// ============================================================================
/// Protege contra abuso y DDoS
const locationLimiter = rateLimit({
  windowMs: 60 * 1000, // Ventana de 1 minuto
  max: 1000, // Máximo 1000 requests por minuto
  message: 'Demasiadas solicitudes desde esta IP, por favor intente más tarde',
  standardHeaders: true, // Retorna info de rate limit en header RateLimit-*
  legacyHeaders: false, // Desactiva headers X-RateLimit-*
  skip: (req) => req.user?.role === 'admin', // Admins no tienen rate limit
  trustProxy: true, // Confiar en X-Forwarded-For header (para proxies como nginx)
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Ventana de 15 minutos
  max: 500, // Máximo 500 requests por 15 minutos
  message: 'Demasiadas solicitudes, por favor intente más tarde',
  skip: (req) => req.user?.role === 'admin', // Admins no tienen rate limit
  trustProxy: true, // Confiar en X-Forwarded-For header (para proxies como nginx)
});

// Trust proxy for X-Forwarded-For header (required for rate-limit)
app.set('trust proxy', 1);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(apiLimiter); // Aplicar rate limiting general a toda la API

// Real-time integration
const io = initSocket(server);
app.set('socketio', io);

// API Routes
app.use('/api/auth', authRoutes);
app.post('/api/locations/batch', locationLimiter);
app.use('/api/locations', locationRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/geocoding', geocodingRoutes);
app.use('/api/routes', routeAssignmentRoutes);
app.use('/api/customers', customerRoutes);

// Basic health check
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

const { syncSchema } = require('./db/postgres');

const PORT = process.env.API_PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
  logger.info(`Server listening on 0.0.0.0:${PORT}`);
  logger.info(`Compression: ENABLED ✅`);
  logger.info(`Rate Limiting: ENABLED ✅`);

  // Automate DB schema synchronization
  await syncSchema();
});
