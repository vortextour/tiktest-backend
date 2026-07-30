const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
// Redis ইমপোর্ট (রেট লিমিটিং এর জন্য)
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');

// Redis ক্লায়েন্ট সেটআপ (যদি REDIS_URL না থাকে তবে লোকাল মেমরি ব্যবহার করবে)
const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

if (redisClient) {
  redisClient.on('error', (err) => console.error('🔥 Redis Connection Error:', err.message));
}

// রেট লিমিট তৈরি করার হেল্পার ফাংশন (ENV সাপোর্ট সহ)
const createLimiter = (prefix, defaultWindowMs, defaultMax, message) => {
  const windowMs = process.env[`RL_WINDOW_${prefix.toUpperCase()}`] || defaultWindowMs;
  const max = process.env[`RL_MAX_${prefix.toUpperCase()}`] || defaultMax;
  
  const options = {
    windowMs: parseInt(windowMs, 10),
    max: parseInt(max, 10),
    standardHeaders: true, // `RateLimit-*` হেডার রিটার্ন করবে
    legacyHeaders: false, // `X-RateLimit-*` হেডার ডিসেবল করবে
    message: { success: false, error: message },
  };
  
  // যদি Redis কনফিগার করা থাকে, তবে ডিস্ট্রিবিউটেড স্টোর হিসেবে Redis ব্যবহার করবে
  if (redisClient) {
    options.store = new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: `rl:${prefix}:`
    });
  }
  
  return rateLimit(options);
};

// ১. Public API Limiter (TikTok download/metadata)
const publicApiLimiter = createLimiter('public', 15 * 60 * 1000, 100, 'Too many API requests, please try again later.');

// ২. Video Streaming/Download Limiter (স্ট্রিমিং এর জন্য একটু বেশি লিমিট)
const videoStreamLimiter = createLimiter('video', 15 * 60 * 1000, 300, 'Too many video stream requests, please try again later.');

// ৩. Admin Login Limiter (ব্রুট-ফোর্স অ্যাটাক ঠেকানোর জন্য কড়া লিমিট)
const adminLoginLimiter = createLimiter('admin_login', 15 * 60 * 1000, 5, 'Too many login attempts. Please try again after 15 minutes.');

// ৪. Admin API Limiter (লগইন করা অ্যাডমিনদের সাধারণ রিকোয়েস্টের জন্য)
const adminApiLimiter = createLimiter('admin_api', 15 * 60 * 1000, 500, 'Admin API rate limit exceeded.');

// Admin Authentication Middleware (Secure JWT)
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Access Denied. Missing or invalid token format.' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    // শুধুমাত্র 'HS256' অ্যালগরিদম অ্যালাউ করে "none" অ্যালগরিদম অ্যাটাক রোধ করা হয়েছে
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.admin = decoded;
    next();
  } catch (ex) {
    if (ex.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
};

// Async Handler (অ্যাসিঙ্ক্রোনাস রাউটগুলোতে try-catch এর বয়লারপ্লেট কোড কমানোর জন্য)
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Global Error Handler
const errorHandler = (err, req, res, next) => {
  // ম্যালফর্মড (Malformed) JSON বা বডি-পার্সার এরর হ্যান্ডলিং (400 Bad Request)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Malformed request data. Invalid JSON.' });
  }
  
  // সেনসিটিভ ডেটা (যেমন: টোকেন বা পাসওয়ার্ড) লগ থেকে মুছে ফেলা
  const safeErrorMessage = err.message ?
    err.message.replace(/(bearer\s)[^\s]+/gi, '$1[HIDDEN]').replace(/(password=)[^\s]+/gi, '$1[HIDDEN]') :
    'Unknown error occurred';
  
  console.error(`🔥 Error [${req.method} ${req.url}]:`, safeErrorMessage);
  
  // প্রোডাকশনে কখনোই ক্লায়েন্টকে স্ট্যাক ট্রেস পাঠানো যাবে না
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }
  
  // যদি কাস্টম স্ট্যাটাস কোড থাকে সেটা ব্যবহার হবে, নয়তো 500
  const statusCode = err.status || 500;
  
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Internal Server Error' : err.message
  });
};

module.exports = {
  publicApiLimiter,
  videoStreamLimiter,
  adminLoginLimiter,
  adminApiLimiter,
  verifyAdmin,
  asyncHandler,
  errorHandler
};