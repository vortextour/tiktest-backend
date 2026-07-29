const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const initDB = async () => {
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
    console.log("✅ PostgreSQL Tables Initialized");
  } catch (err) {
    console.error("❌ Database Init Error:", err);
  }
};

module.exports = { pool, initDB };