const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const xss = require('xss-clean');
require('dotenv').config();

const { initDB } = require('./database');
const { connectRedis } = require('./redis');
const routes = require('./routes');
const { errorHandler } = require('./middleware');

const app = express();

// Security Middlewares
app.use(helmet());
app.use(cors());
app.use(xss());
app.use(express.json({ limit: '10kb' })); // Body parser with size limit

// API Routes
app.use('/api/v1', routes);

// Health Check Endpoint (For Docker / Production load balancers)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Initialize Server, DB, and Redis
const startServer = async () => {
  await initDB();
  await connectRedis();
  
  const server = app.listen(PORT, () => {
    console.log(`🚀 Production Server running on port ${PORT}`);
  });
  
  // Graceful Shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
    });
  });
};

startServer();