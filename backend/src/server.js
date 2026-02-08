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
const farmRoutes = require('./routes/farmHandler');
const geoRoutes = require('./routes/geo');
const cropRoutes = require('./routes/crops');
const { router: reportRoutes } = require('./routes/reportsHandler');
const linearOptimizationRoutes = require('./routes/linearOptimization');
const modelRoutes = require('./routes/models');
const authRoutes = require('./routes/auth');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for correct IP detection behind reverse proxies
app.set('trust proxy', process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY) : 1);

// Security middleware
app.use(helmet());

// CORS configuration - restrict origins in production
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false, // No default '*' - require explicit config
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware - configurable limits
const bodyLimit = process.env.BODY_LIMIT || '10mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting - global for /api/
// TODO: Add stricter rate limits for sensitive endpoints (e.g., auth routes if added)
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
app.use('/api/farms', farmRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/crops', cropRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/linear-optimization', linearOptimizationRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/auth', authRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Michigan Solar Optimization API',
    version: '1.0.0',
    endpoints: {
      farms: '/api/farms',
      geo: '/api/geo',
      crops: '/api/crops',
      reports: '/api/reports',
      linearOptimization: '/api/linear-optimization',
      models: '/api/models',
      auth: '/api/auth',
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
    // Test database connection (optional - server can run without DB for static endpoints)
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.warn('⚠ Database connection failed. Some endpoints may not work.');
    }

    // Start listening
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n✓ Michigan Solar API Server running`);
      console.log(`✓ Port: ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ API Base URL: http://localhost:${PORT}/api`);
      console.log(`\nAvailable endpoints:`);
      
      // Dynamically list all registered routes
      const routes = [];
      app._router.stack.forEach((middleware) => {
        if (middleware.route) {
          // Routes registered directly on the app
          const methods = Object.keys(middleware.route.methods).map(m => m.toUpperCase()).join(', ');
          routes.push(`  ${methods.padEnd(6)} ${middleware.route.path}`);
        } else if (middleware.name === 'router') {
          // Routes registered via router
          middleware.handle.stack.forEach((handler) => {
            if (handler.route) {
              const methods = Object.keys(handler.route.methods).map(m => m.toUpperCase()).join(', ');
              // Extract base path from router regex
              let basePath = '';
              const regexStr = middleware.regexp.source;
              const match = regexStr.match(/^\\\/([^\\?]*)/);
              if (match) {
                basePath = '/' + match[1].replace(/\\\//g, '/');
              }
              routes.push(`  ${methods.padEnd(6)} ${basePath}${handler.route.path}`);
            }
          });
        }
      });
      
      routes.sort().forEach(route => console.log(route));
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
