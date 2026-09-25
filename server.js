// server.js - CSPC Lost & Found Management System (Node.js & Express)
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/authRoutes');
const itemRoutes = require('./routes/itemRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Request parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  name: 'cspc.sid',
  secret: 'cspc-lostfound-secret-key-nabua-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/stats', (req, res) => res.redirect('/api/items/stats'));

// Static assets (CSS, logo, client JS)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // fallback to root

// Page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 404 Handler for API
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected server error occurred.'
  });
});

app.listen(PORT, () => {
  console.log(` Server running at: http://localhost:${PORT}`);
});
