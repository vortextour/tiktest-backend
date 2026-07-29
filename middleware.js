const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Rate Limiter for Public API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { success: false, error: "Too many requests, please try again later." }
});

// Admin Authentication Middleware
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, error: "Access Denied. No token provided." });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (ex) {
    res.status(400).json({ success: false, error: "Invalid token." });
  }
};

// Global Error Handler
const errorHandler = (err, req, res, next) => {
  console.error("🔥 Error Log:", err.stack);
  res.status(500).json({ success: false, error: "Internal Server Error" });
};

module.exports = { apiLimiter, verifyAdmin, errorHandler };