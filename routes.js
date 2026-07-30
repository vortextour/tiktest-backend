const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Readable } = require('stream');
const { queryDB } = require('./database');
const { cacheGet, cacheSet, acquireLock, releaseLock } = require('./redis');
const { extractTikTokData, validateAndNormalizeURL } = require('./tiktokService');
const { publicApiLimiter, videoStreamLimiter, adminLoginLimiter, adminApiLimiter, verifyAdmin, asyncHandler } = require('./middleware');

// XSS Sanitizer Helper (লাইটওয়েট - কোনো থার্ড পার্টি লাইব্রেরি ছাড়া)
const sanitizeHTML = (str) => {
  if (typeof str !== 'string') return '';
  return str.replace(/<script[^>]*?>.*?<\/script>/gi, '')
    .replace(/<[\/\!]*?[^<>]*?>/gi, '')
    .replace(/onload|onerror|onmouseover|onclick/gi, '');
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

// ==========================================
// 1. PUBLIC TIKTOK DOWNLOADER API (METADATA)
// ==========================================
router.post('/download', publicApiLimiter, asyncHandler(async (req, res) => {
  const { url } = req.body;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: "Invalid URL provided." });
  }
  
  const cleanUrl = validateAndNormalizeURL(url);
  if (!cleanUrl) return res.status(400).json({ success: false, error: "Invalid TikTok URL." });
  
  const cacheKey = `tk:meta:${Buffer.from(cleanUrl).toString('base64')}`;
  let videoData = await cacheGet(cacheKey);
  
  // Cache Stampede Protection (Distributed Lock)
  if (!videoData) {
    const lockKey = `lock:${cacheKey}`;
    let locked = await acquireLock(lockKey, 15);
    let retries = 5;
    
    // Duplicate Request রোধ
    while (!locked && retries > 0) {
      await delay(1000);
      videoData = await cacheGet(cacheKey);
      if (videoData) break;
      locked = await acquireLock(lockKey, 15);
      retries--;
    }
    
    if (!videoData && !locked) {
      return res.status(429).json({ success: false, error: "Server busy processing this video. Please try again." });
    }
    
    if (!videoData) {
      try {
        videoData = await extractTikTokData(cleanUrl);
        await cacheSet(cacheKey, videoData, 900); // ১৫ মিনিট ক্যাশ থাকবে
      } finally {
        await releaseLock(lockKey);
      }
    }
  }
  
  // Secure Stream Token জেনারেট করা
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  
  const createToken = async (mediaUrl, quality) => {
    if (!mediaUrl) return '';
    const token = crypto.randomBytes(16).toString('hex'); // Unpredictable Token
    const tokenData = { mediaUrl, quality, originalUrl: cleanUrl, ip: clientIp };
    await cacheSet(`stream:${token}`, tokenData, 1800); // টোকেনটি ৩০ মিনিট ভ্যালিড থাকবে
    
    // 🟢 মূল পরিবর্তন (URL Mismatch Fix): এখানে v1 যুক্ত করা হয়েছে 
    return `/api/v1/stream/${token}`; 
  };
  
  // Cached অবজেক্ট যেন পরিবর্তন না হয়, তাই Deep Copy করা হলো
  const responseData = JSON.parse(JSON.stringify(videoData));
  
  responseData.downloads.hd.url = await createToken(videoData.downloads.hd.url, 'HD');
  responseData.downloads.standard.url = await createToken(videoData.downloads.standard.url, 'SD');
  responseData.downloads.watermark.url = await createToken(videoData.downloads.watermark.url, 'Watermark');
  
  res.json({ success: true, data: responseData });
}));

// ==========================================
// 2. SECURE INSTANT STREAM & DOWNLOAD PROXY
// ==========================================
router.get('/stream/:token', videoStreamLimiter, asyncHandler(async (req, res) => {
  const { token } = req.params;
  
  // Token Validation
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return res.status(400).json({ success: false, error: "Invalid token format." });
  }
  
  const tokenData = await cacheGet(`stream:${token}`);
  if (!tokenData) {
    return res.status(403).json({ success: false, error: "Stream link expired or invalid. Please search again." });
  }
  
  const { mediaUrl, quality, originalUrl } = tokenData;
  
  // 🟢 SSRF FIX: টিকটকের ও অন্যান্য CDN ডোমেইনগুলো এলাউ করা হয়েছে
  try {
    const parsedUrl = new URL(mediaUrl);
    const validDomains = ['tikwm.com', 'tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'akamaized.net', 'bytecdn.cn', 'douyinvod.com'];
    const isValid = validDomains.some(d => parsedUrl.hostname.includes(d));
    if (!isValid) return res.status(502).json({ success: false, error: "Invalid upstream provider." });
  } catch (e) {
    return res.status(400).json({ success: false, error: "Malformed media URL." });
  }
  
  // Database Logging: শুধুমাত্র প্রথম ডাউনলোডে/স্ট্রিমে কাউন্ট হবে
  const dbLogKey = `logged:${token}`;
  const hasLogged = await cacheGet(dbLogKey);
  if (!hasLogged) {
    const currentIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    try {
        await queryDB('INSERT INTO downloads (video_url, quality, ip_address) VALUES ($1, $2, $3)', [originalUrl, quality, currentIp]);
    } catch (ignored) {} // DB এরর দিলেও ভিডিও প্লে হওয়া বন্ধ হবে না
    await cacheSet(dbLogKey, true, 1800);
  }
  
  const controller = new AbortController();
  req.on('close', () => controller.abort()); // Client ব্রাউজার কেটে দিলে Upstream রিকোয়েস্টও বন্ধ হবে
  
  try {
    // 🟢 Header FIX: Referer ও User-Agent আপডেট করা হয়েছে
    const fetchOptions = {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tikwm.com/', 
        'Accept': '*/*'
      }
    };
    
    // Video Seeking (Range) সাপোর্ট
    if (req.headers.range) {
      fetchOptions.headers['Range'] = req.headers.range;
    }
    
    const upstreamRes = await fetch(mediaUrl, fetchOptions);
    
    if (!upstreamRes.ok) {
      if (upstreamRes.status === 416) return res.status(416).send('Range Not Satisfiable');
      throw new Error(`Upstream error: ${upstreamRes.status}`);
    }
    
    // Header Injection & CRLF Prevention
    const rawFilename = req.query.filename || 'TikSavePro_Video.mp4';
    const safeFilename = rawFilename.replace(/[^a-zA-Z0-9.\-_]/g, '');
    
    // 🟢 Video Player Fix: ফ্রন্টএন্ডে প্লে করার জন্য inline, আর ডাউনলোডের জন্য attachment
    const dispositionType = req.query.filename ? 'attachment' : 'inline';
    
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeFilename}"`);
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'video/mp4');
    
    ['content-length', 'content-range', 'accept-ranges'].forEach(header => {
      if (upstreamRes.headers.has(header)) {
        res.setHeader(header, upstreamRes.headers.get(header));
      }
    });
    
    res.status(upstreamRes.status); // 200 (Full) or 206 (Partial)
    
    if (upstreamRes.body) {
      const stream = Readable.fromWeb(upstreamRes.body);
      stream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('🔥 Stream Proxy Error:', error.message);
      if (!res.headersSent) res.status(502).json({ success: false, error: "Upstream streaming failed." });
    }
  }
}));

// ==========================================
// 3. PUBLIC FAQ & BLOG APIs (Cached)
// ==========================================
router.get('/faqs', publicApiLimiter, asyncHandler(async (req, res) => {
  let faqs = await cacheGet('public:faqs');
  if (!faqs) {
    const result = await queryDB('SELECT id, question, answer FROM faqs ORDER BY id ASC');
    faqs = result.rows;
    await cacheSet('public:faqs', faqs, 86400); // 24 ঘণ্টা ক্যাশ
  }
  res.json({ success: true, data: faqs });
}));

router.get('/blogs', publicApiLimiter, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10)); // Max 50 items
  const offset = (page - 1) * limit;
  
  const cacheKey = `public:blogs:${page}:${limit}`;
  let blogs = await cacheGet(cacheKey);
  
  if (!blogs) {
    const result = await queryDB(
      "SELECT id, title, content, created_at FROM blogs WHERE status = 'published' ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [limit, offset]
    );
    blogs = result.rows;
    await cacheSet(cacheKey, blogs, 3600); // ১ ঘণ্টা ক্যাশ
  }
  res.json({ success: true, data: blogs, page, limit });
}));

// ==========================================
// 4. ADMIN AUTHENTICATION
// ==========================================
router.post('/admin/login', adminLoginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password required" });
  }
  
  const result = await queryDB('SELECT id, password FROM admin WHERE username = $1 LIMIT 1', [username]);
  if (result.rows.length === 0) return res.status(401).json({ success: false, error: "Invalid credentials" });
  
  const validPass = await bcrypt.compare(password, result.rows[0].password);
  if (!validPass) return res.status(401).json({ success: false, error: "Invalid credentials" });
  
  const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' });
  res.json({ success: true, token });
}));

// ==========================================
// 5. ADMIN PROTECTED APIs
// ==========================================
router.get('/admin/analytics', verifyAdmin, adminApiLimiter, asyncHandler(async (req, res) => {
  let stats = await cacheGet('admin:analytics');
  if (!stats) {
    const totalDownloads = await queryDB('SELECT COUNT(*) FROM downloads');
    stats = { total_downloads: parseInt(totalDownloads.rows[0].count, 10) };
    await cacheSet('admin:analytics', stats, 300); // ৫ মিনিট ক্যাশ
  }
  res.json({ success: true, data: stats });
}));

router.post('/admin/blogs', verifyAdmin, adminApiLimiter, asyncHandler(async (req, res) => {
  const { title, content, status } = req.body;
  if (!title || !content) return res.status(400).json({ success: false, error: "Title and content required." });
  
  const safeTitle = sanitizeHTML(title);
  const safeContent = sanitizeHTML(content);
  const safeStatus = ['published', 'draft'].includes(status) ? status : 'draft';
  
  await queryDB('INSERT INTO blogs (title, content, status) VALUES ($1, $2, $3)', [safeTitle, safeContent, safeStatus]);
  
  res.json({ success: true, message: "Blog created successfully." });
}));

module.exports = router;
