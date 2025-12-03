const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { testConnection } = require('./database');

// Load environment variables
dotenv.config();

// Import routes
const solarRoutes = require('./routes/solar');
const farmRoutes = require('./routes/farms');
const geoRoutes = require('./routes/geo');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api/solar', solarRoutes);
app.use('/api/farms', farmRoutes);
app.use('/api/geo', geoRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Michigan Solar Optimization API',
    version: '1.0.0',
    endpoints: {
      solar: '/api/solar',
      farms: '/api/farms',
      geo: '/api/geo',
      health: '/health',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: err.name || 'Error',
    message: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Start server
async function startServer() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Start listening
    app.listen(PORT, () => {
      console.log(`\n✓ Michigan Solar API Server running`);
      console.log(`✓ Port: ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ API Base URL: http://localhost:${PORT}/api`);
      console.log(`\nAvailable endpoints:`);
      console.log(`  GET  /health`);
      console.log(`  GET  /api/solar/point/:lat/:lng`);
      console.log(`  GET  /api/solar/bbox`);
      console.log(`  POST /api/solar/polygon`);
      console.log(`  GET  /api/farms`);
      console.log(`  POST /api/farms`);
      console.log(`  GET  /api/geo/counties`);
      console.log(`  GET  /api/geo/cities/:countyId`);
      console.log(`\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing HTTP server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received. Closing HTTP server...');
  process.exit(0);
});

// Start the server
startServer();

module.exports = app;
