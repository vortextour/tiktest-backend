const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const { initDB, checkDBHealth, closeDB } = require('./database');
const { connectRedis, redisClient } = require('./redis');
const routes = require('./routes');
const { errorHandler } = require('./middleware');

const app = express();

// ১. Render / Reverse Proxy Configuration (ক্লায়েন্টের সঠিক IP পাওয়ার জন্য)
app.set('trust proxy', 1);

// ২. Security Headers (Helmet)
app.use(helmet({
    crossOriginResourcePolicy: false // ভিডিও স্ট্রিমিং ও ক্রস-অরিজিন রিসোর্সের জন্য
}));

// ৩. Dynamic Smart CORS (Localhost, Render URL & Future Custom Domain Support)
const corsOptions = {
    origin: function (origin, callback) {
        const envCors = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.trim() : '*';
        
        // রিকোয়েস্টে Origin না থাকলে (যেমন: Curl, Postman) অথবা CORS_ORIGIN=* হলে সরাসরি এলাউ করবে
        if (!origin || envCors === '*') {
            return callback(null, true);
        }

        const allowedList = envCors.split(',').map(domain => domain.trim());
        
        // যদি রিকোয়েস্ট করা ডোমেইন লিস্টে থাকে অথবা Localhost হয়, তবে এলাউ করবে
        if (allowedList.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }

        // সিকিউর ফলব্যাক (ভবিষ্যতে কাস্টম ডোমেইন সেট করলেও ব্লক হবে না)
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));

// ৪. Body Parser (Payload Limit - DoS প্রোটেকশন)
app.use(express.json({ limit: '10kb' }));

// ==========================================
// 🚀 Health & Readiness Check Endpoints
// ==========================================

// Liveness Check (খুবই লাইটওয়েট - রেন্ডার হেলথ চেকের জন্য)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: new Date() });
});

// Readiness Check (Database & Redis স্বাস্থ্য পরীক্ষা)
app.get('/ready', async (req, res) => {
    const isDbHealthy = await checkDBHealth();
    const isRedisHealthy = redisClient && redisClient.isOpen;
    
    if (isDbHealthy && isRedisHealthy) {
        res.status(200).json({ status: 'READY', db: true, redis: true });
    } else {
        res.status(503).json({ status: 'UNAVAILABLE', db: isDbHealthy, redis: !!isRedisHealthy });
    }
});

// ==========================================
// 🛣️ Main API Routes
// ==========================================
app.use('/api/v1', routes);

// Global Error Handler
app.use(errorHandler);

// ==========================================
// 🛑 Server Initialization & Graceful Shutdown
// ==========================================
const PORT = process.env.PORT || 5000;
let server;
let isShuttingDown = false;

const startServer = async () => {
    try {
        await initDB();
        await connectRedis();
        
        server = app.listen(PORT, () => {
            console.log(`🚀 Production Server running safely on port ${PORT}`);
        });
    } catch (error) {
        console.error('🔥 Fatal Error during startup:', error.message);
        process.exit(1);
    }
};

// সেফ শাটডাউন মেকানিজম (সার্ভার বন্ধের সময় মেমরি বা কানেকশন লিক রোধ করবে)
const gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    // ১০ সেকেন্ডের নিরাপদ টাইমআউট
    const timeout = setTimeout(() => {
        console.error('🔥 Could not close connections in time, forcefully shutting down.');
        process.exit(1);
    }, 10000);

    if (server) {
        server.close(async (err) => {
            clearTimeout(timeout);
            if (err) console.error('🔥 HTTP Server close error:', err.message);
            else console.log('✅ HTTP Server closed successfully.');
            
            try {
                // ১. ডেটাবেস কানেকশন নিরাপদভাবে বন্ধ করা
                await closeDB(); 
                
                // ২. রেডিজ কানেকশন নিরাপদভাবে বন্ধ করা
                if (redisClient && redisClient.isOpen) {
                    await redisClient.quit();
                    console.log('✅ Redis connection closed cleanly.');
                }
            } catch (e) {
                console.error('🔥 Error during dependency shutdown:', e.message);
            } finally {
                process.exit(err ? 1 : 0);
            }
        });
    } else {
        clearTimeout(timeout);
        process.exit(0);
    }
};

// প্রসেস সিগন্যাল লিসেনার
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
