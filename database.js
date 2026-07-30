const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL Connection Pool সেটআপ
const pool = new Pool({
    // Supabase এর ক্ষেত্রে সরাসরি DATABASE_URL (Transaction pooler - port 6543) ব্যবহার করা উত্তম
    connectionString: process.env.DATABASE_URL || undefined,
    
    // Fallbacks (যদি DATABASE_URL না থাকে)
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    
    // Supabase ক্লাউডের জন্য SSL বাধ্যতামূলক
    ssl: { rejectUnauthorized: false }, 

    // 🚀 Pooling & Performance Optimizations
    max: parseInt(process.env.DB_POOL_MAX || '10', 10), // একসাথে সর্বোচ্চ কতগুলো কানেকশন থাকবে
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10), // অলস কানেকশন ৩০ সেকেন্ড পর বন্ধ হবে
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10), // ৫ সেকেন্ডের মধ্যে কানেক্ট না হলে এরর দিবে
});

// Idle Client এরর হ্যান্ডলার (Node.js অ্যাপ ক্র্যাশ হওয়া থেকে বাঁচানোর জন্য)
pool.on('error', (err) => {
    console.error('❌ Unexpected database error on idle client:', err.message);
});

// 🩺 Lightweight DB Health Check (সার্ভার চালুর সময় শুধু কানেকশন চেক করবে)
const checkDBHealth = async () => {
    try {
        const res = await pool.query('SELECT 1 AS health_check');
        if (res.rowCount === 1) {
            console.log('✅ PostgreSQL Database connected and healthy');
            return true;
        }
        return false;
    } catch (err) {
        console.error('❌ Database Health Check Failed:', err.message);
        return false;
    }
};

// 🛑 Graceful Shutdown (সার্ভার বন্ধ হওয়ার সময় কানেকশন ক্লিন করা)
const closeDB = async () => {
    console.log('🛑 Closing PostgreSQL connection pool...');
    try {
        await pool.end();
        console.log('✅ PostgreSQL pool closed cleanly.');
    } catch (err) {
        console.error('❌ Error during PostgreSQL pool shutdown:', err.message);
    }
};

// Node.js প্রসেস বন্ধ হওয়ার সিগন্যাল
process.on('SIGINT', async () => { await closeDB(); process.exit(0); });
process.on('SIGTERM', async () => { await closeDB(); process.exit(0); });

// 🏗️ Schema Migrations (প্রতিটি রিকোয়েস্ট বা বুট-আপে টেবিল ক্রিয়েট এড়ানোর জন্য)
const initDB = async () => {
    // প্রোডাকশনে অহেতুক টেবিল স্ক্যান বন্ধ করা হয়েছে। শুধুমাত্র RUN_MIGRATIONS=true থাকলে কাজ করবে
    if (process.env.RUN_MIGRATIONS !== 'true') {
        return await checkDBHealth();
    }

    const query = `
        CREATE TABLE IF NOT EXISTS admin (
            id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, 
            password VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS downloads (
            id SERIAL PRIMARY KEY, video_url TEXT NOT NULL, 
            quality VARCHAR(50), ip_address VARCHAR(45),
            country VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS settings (
            id SERIAL PRIMARY KEY, key VARCHAR(100) UNIQUE NOT NULL, 
            value JSONB NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS blogs (
            id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, 
            content TEXT NOT NULL, status VARCHAR(20) DEFAULT 'published', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS faqs (
            id SERIAL PRIMARY KEY, question TEXT NOT NULL, 
            answer TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS logs (
            id SERIAL PRIMARY KEY, type VARCHAR(50), 
            message TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(query);
        console.log("✅ PostgreSQL Tables Initialized successfully");
    } catch (err) {
        console.error("❌ Database Init Error:", err.message);
    }
};

// 🔥 Helper for Parameterized Queries (সিকিউরিটি এবং পারফরম্যান্সের জন্য)
const queryDB = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        // ৫০০ মিলি-সেকেন্ডের বেশি সময় লাগলে স্লো-ক্যুরি লগ হবে (অপ্টিমাইজেশনের সুবিধার্থে)
        if (duration > 500) {
            console.warn(`⚠️ Slow query detected (${duration}ms): ${text}`);
        }
        return res;
    } catch (err) {
        console.error('❌ Database Query Error:', err.message);
        throw err;
    }
};

module.exports = { pool, initDB, checkDBHealth, closeDB, queryDB };