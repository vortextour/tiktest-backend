const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const { initDB, checkDBHealth, closeDB } = require('./database');
const { connectRedis, redisClient } = require('./redis');
const routes = require('./routes');
const { errorHandler } = require('./middleware');

const app = express();

// ১. Trust Proxy Configuration (Render-এর Reverse Proxy-র পেছনে ক্লায়েন্টের আসল IP পাওয়ার জন্য বাধ্যতামূলক)
app.set('trust proxy', 1);

// ২. Security Middlewares
app.use(helmet()); // সিকিউর HTTP হেডার যুক্ত করবে

// ৩. Configurable CORS (শুধুমাত্র অনুমোদিত ডোমেইন থেকে রিকোয়েস্ট অ্যালাউ করতে)
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// ৪. Body Parser Limit (Payload Too Large বা DoS অ্যাটাক রোধ করতে)
app.use(express.json({ limit: '10kb' }));

// API Routes
app.use('/api/v1', routes);

// ==========================================
// 🚀 Health & Readiness Checks (For Render)
// ==========================================

// Liveness Check: সার্ভার রান করছে কিনা (লাইটওয়েট)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Readiness Check: ডেটাবেস এবং রেডিজ ট্রাফিকের জন্য প্রস্তুত কিনা
app.get('/ready', async (req, res) => {
  const isDbHealthy = await checkDBHealth();
  const isRedisHealthy = redisClient && redisClient.isOpen;
  
  if (isDbHealthy && isRedisHealthy) {
    res.status(200).json({ status: 'READY' });
  } else {
    // 503 দিলে Render Load Balancer এই ইনস্ট্যান্সে ইউজার ট্রাফিক পাঠাবে না
    res.status(503).json({ status: 'UNAVAILABLE', db: isDbHealthy, redis: isRedisHealthy });
  }
});

// Global Error Handler
app.use(errorHandler);

// ==========================================
// 🛑 Server Initialization & Graceful Shutdown
// ==========================================
const PORT = process.env.PORT || 5000;
let server;
let isShuttingDown = false; // ডুপ্লিকেট শাটডাউন রোধ করার জন্য ফ্ল্যাগ

const startServer = async () => {
  try {
    await initDB();
    await connectRedis();
    
    server = app.listen(PORT, () => {
      console.log(`🚀 Production Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('🔥 Fatal Error during startup:', error.message);
    process.exit(1); // এরর থাকলে সার্ভার চালু হবে না
  }
};

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return; // একবার কল হলে দ্বিতীয়বার ইগনোর করবে
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  // ১০ সেকেন্ডের Fail-safe (যদি কানেকশন ক্লোজ হতে বেশি সময় নেয়, তবে ফোর্স শাটডাউন হবে)
  setTimeout(() => {
    console.error('🔥 Could not close connections in time, forcefully shutting down.');
    process.exit(1);
  }, 10000);
  
  if (server) {
    server.close(async (err) => {
      if (err) console.error('🔥 HTTP Server close error:', err.message);
      else console.log('✅ HTTP Server closed. No new requests will be accepted.');
      
      try {
        // ১. ডেটাবেস কানেকশন ক্লোজ
        await closeDB();
        
        // ২. রেডিজ কানেকশন ক্লোজ
        if (redisClient && redisClient.isOpen) {
          await redisClient.quit();
          console.log('✅ Redis connection closed.');
        }
      } catch (e) {
        console.error('🔥 Error during dependency shutdown:', e.message);
      } finally {
        process.exit(err ? 1 : 0);
      }
    });
  } else {
    process.exit(0);
  }
};

// Node.js ইভেন্ট লিসেনার
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();