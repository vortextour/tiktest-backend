const { createClient } = require('redis');
require('dotenv').config();

// 🚀 IN-MEMORY FALLBACK (যদি সার্ভারে Redis না থাকে বা ডিসকানেক্ট হয়, তবে এটি কাজ করবে)
const memoryCache = new Map();

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        console.error('❌ Redis Max Retries Reached. Using In-Memory Fallback.');
        return false;
      }
      return Math.min(retries * 200, 3000);
    }
  }
});

let isRedisConnected = false;

redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err.message));
redisClient.on('connect', () => console.log('⏳ Redis Connecting...'));
redisClient.on('ready', () => {
  console.log('✅ Redis Ready and Connected');
  isRedisConnected = true;
});
redisClient.on('end', () => {
  console.log('⚠️ Redis Disconnected. Switched to Memory Cache.');
  isRedisConnected = false;
});

const connectRedis = async () => {
  if (process.env.REDIS_URL) {
    try {
      await redisClient.connect();
    } catch (err) {
      console.error('❌ Initial Redis connection failed. Using Memory Cache.');
    }
  } else {
    console.log('⚠️ REDIS_URL not provided. Using fast In-Memory Cache.');
  }
};

const gracefulShutdown = async () => {
  if (isRedisConnected && redisClient.isOpen) {
    console.log('🛑 Closing Redis connection gracefully...');
    await redisClient.quit();
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ==========================================
// REUSABLE CACHE HELPERS (With Auto Fallback)
// ==========================================

const cacheGet = async (key) => {
  if (!isRedisConnected) {
    const item = memoryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      memoryCache.delete(key);
      return null;
    }
    return JSON.parse(item.value);
  }
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    return null;
  }
};

const cacheSet = async (key, value, ttlInSeconds = 3600) => {
  const stringData = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (!isRedisConnected) {
    memoryCache.set(key, { value: stringData, expiry: Date.now() + (ttlInSeconds * 1000) });
    return true;
  }
  try {
    await redisClient.set(key, stringData, { EX: ttlInSeconds });
    return true;
  } catch (err) {
    return false;
  }
};

const cacheDel = async (key) => {
  if (!isRedisConnected) {
    memoryCache.delete(key);
    return true;
  }
  try {
    await redisClient.del(key);
    return true;
  } catch (err) {
    return false;
  }
};

const acquireLock = async (key, ttlInSeconds = 10) => {
  if (!isRedisConnected) {
    if (memoryCache.has(key) && Date.now() < memoryCache.get(key).expiry) return false;
    memoryCache.set(key, { value: 'LOCKED', expiry: Date.now() + (ttlInSeconds * 1000) });
    return true;
  }
  try {
    const result = await redisClient.set(key, 'LOCKED', { NX: true, EX: ttlInSeconds });
    return result === 'OK';
  } catch (err) {
    return false;
  }
};

const releaseLock = async (key) => {
  return await cacheDel(key);
};

module.exports = {
  redisClient, connectRedis, cacheGet, cacheSet, cacheDel, acquireLock, releaseLock
};
