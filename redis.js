const { createClient } = require('redis');
require('dotenv').config();

// Redis Client কনফিগারেশন এবং Reconnect Strategy
const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      // ১০ বারের বেশি চেষ্টা করলে ইনফিনিট লুপ এড়ানোর জন্য কানেকশন বন্ধ করা হবে
      if (retries > 10) {
        console.error('❌ Redis Max Retries Reached. Giving up.');
        return false;
      }
      // Exponential backoff: প্রতিবার সময় বাড়বে, তবে সর্বোচ্চ ৩ সেকেন্ড
      return Math.min(retries * 200, 3000);
    }
  }
});

let isRedisConnected = false;

// Redis ইভেন্ট হ্যান্ডলার
redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error:', err.message);
});

redisClient.on('connect', () => console.log('⏳ Redis Connecting...'));

redisClient.on('ready', () => {
  console.log('✅ Redis Ready and Connected');
  isRedisConnected = true;
});

redisClient.on('end', () => {
  console.log('⚠️ Redis Disconnected');
  isRedisConnected = false;
});

const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (err) {
    console.error('❌ Initial Redis connection failed:', err.message);
  }
};

// Graceful Shutdown (Node.js বন্ধ হওয়ার আগে Redis ক্লিনভাবে ডিসকানেক্ট করা)
const gracefulShutdown = async () => {
  if (redisClient.isOpen) {
    console.log('🛑 Closing Redis connection gracefully...');
    await redisClient.quit();
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);


// ==========================================
// REUSABLE REDIS HELPERS (With Fault Tolerance)
// ==========================================

// ১. GET Data
const cacheGet = async (key) => {
  if (!isRedisConnected) return null; // Redis ডাউন থাকলে অ্যাপ ক্র্যাশ করবে না
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`❌ Redis GET Error (${key}):`, err.message);
    return null;
  }
};

// ২. SET Data with TTL (ডিফল্ট ১ ঘণ্টা)
const cacheSet = async (key, value, ttlInSeconds = 3600) => {
  if (!isRedisConnected) return false;
  try {
    // শুধুমাত্র প্রয়োজনীয় স্ট্রিং বা JSON সেভ করা
    const stringData = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // SET EX ব্যবহার করে একটি কমান্ডেই ডেটা এবং TTL সেট করা
    await redisClient.set(key, stringData, { EX: ttlInSeconds });
    return true;
  } catch (err) {
    console.error(`❌ Redis SET Error (${key}):`, err.message);
    return false;
  }
};

// ৩. DELETE Data
const cacheDel = async (key) => {
  if (!isRedisConnected) return false;
  try {
    await redisClient.del(key);
    return true;
  } catch (err) {
    console.error(`❌ Redis DEL Error (${key}):`, err.message);
    return false;
  }
};

// ৪. ACQUIRE LOCK (Distributed Locking for Cache Stampede Protection)
const acquireLock = async (key, ttlInSeconds = 10) => {
  if (!isRedisConnected) return false;
  try {
    // SET NX EX: কি (key) না থাকলে সেট করবে এবং নির্দিষ্ট সময় পর অটো রিমুভ হবে
    const result = await redisClient.set(key, 'LOCKED', { NX: true, EX: ttlInSeconds });
    return result === 'OK';
  } catch (err) {
    console.error(`❌ Redis LOCK Error (${key}):`, err.message);
    return false;
  }
};

// ৫. RELEASE LOCK
const releaseLock = async (key) => {
  if (!isRedisConnected) return false;
  try {
    await redisClient.del(key);
    return true;
  } catch (err) {
    console.error(`❌ Redis UNLOCK Error (${key}):`, err.message);
    return false;
  }
};

module.exports = {
  redisClient,
  connectRedis,
  cacheGet,
  cacheSet,
  cacheDel,
  acquireLock,
  releaseLock
};