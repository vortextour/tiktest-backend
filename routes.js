const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./database');
const { redisClient } = require('./redis');
const { extractTikTokData } = require('./tiktokService');
const { apiLimiter, verifyAdmin } = require('./middleware');

// ==========================================
// 1. PUBLIC TIKTOK DOWNLOADER API
// ==========================================
router.post('/download', apiLimiter, async (req, res) => {
    const { url } = req.body;
    
    if (!url) return res.status(400).json({ success: false, error: "URL is required" });

    try {
        // Check Cache
        const cachedData = await redisClient.get(`tiktok:${url}`);
        if (cachedData) {
            return res.json({ success: true, data: JSON.parse(cachedData), source: 'cache' });
        }

        // Fetch Data from Scraper Service
        const videoData = await extractTikTokData(url);

        // Save Cache (Expires in 24 Hours)
        await redisClient.setEx(`tiktok:${url}`, 86400, JSON.stringify(videoData));

        // Log Download to Analytics (PostgreSQL)
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await pool.query('INSERT INTO downloads (video_url, quality, ip_address) VALUES ($1, $2, $3)', [url, 'HD', ip]);

        res.json({ success: true, data: videoData });
    } catch (error) {
        let msg = "Failed to process video.";
        if (error.message === "INVALID_URL") msg = "Invalid TikTok URL provided.";
        if (error.message === "VIDEO_NOT_FOUND") msg = "Video deleted or not found.";
        if (error.message === "PRIVATE_VIDEO") msg = "This video is private.";
        
        res.status(400).json({ success: false, error: msg });
    }
});

// ==========================================
// 2. DIRECT FILE DOWNLOAD PROXY ROUTE
// ==========================================
router.get('/download-file', async (req, res) => {
    const videoUrl = req.query.url;
    const filename = req.query.filename || 'TikSavePro_Video.mp4';

    if (!videoUrl) return res.status(400).send('Video URL is required');

    try {
        const response = await fetch(videoUrl);
        if (!response.ok) throw new Error('Failed to fetch video stream');

        // Headers to force file download in browsers
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'video/mp4');

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
    } catch (error) {
        console.error('Download Stream Proxy Error:', error);
        res.status(500).send('Error downloading video file.');
    }
});

// ==========================================
// 3. PUBLIC FAQ & BLOG APIs
// ==========================================
router.get('/faqs', async (req, res) => {
    const result = await pool.query('SELECT * FROM faqs ORDER BY id ASC');
    res.json({ success: true, data: result.rows });
});

router.get('/blogs', async (req, res) => {
    const result = await pool.query("SELECT * FROM blogs WHERE status = 'published' ORDER BY created_at DESC");
    res.json({ success: true, data: result.rows });
});

// ==========================================
// 4. ADMIN AUTHENTICATION
// ==========================================
router.post('/admin/login', apiLimiter, async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM admin WHERE username = $1', [username]);
    
    if (result.rows.length === 0) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const validPass = await bcrypt.compare(password, result.rows[0].password);
    if (!validPass) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, token });
});

// ==========================================
// 5. ADMIN PROTECTED APIs
// ==========================================
router.get('/admin/analytics', verifyAdmin, async (req, res) => {
    const totalDownloads = await pool.query('SELECT COUNT(*) FROM downloads');
    res.json({ success: true, data: { total_downloads: totalDownloads.rows[0].count } });
});

router.post('/admin/blogs', verifyAdmin, async (req, res) => {
    const { title, content, status } = req.body;
    await pool.query('INSERT INTO blogs (title, content, status) VALUES ($1, $2, $3)', [title, content, status]);
    res.json({ success: true, message: "Blog created successfully" });
});

module.exports = router;
