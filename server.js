// server.js - CSPC Lost & Found Management System (Node.js & Express)
// Hostinger injects production variables directly; load .env only for local development.
if (!['test', 'production'].includes(process.env.NODE_ENV)) require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/authRoutes');
const itemRoutes = require('./routes/itemRoutes');
const postgresStore = require('./services/postgresStore');

function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  // Resolve configured paths once so sendFile/static serving work with values
  // such as DATA_DIR=./data in production environments.
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
  const sessionSecret = process.env.SESSION_SECRET || (isProduction ? '' : 'cspc-lostfound-development-only');

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET must be configured in production.');
  }

  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));
  app.use(session({
    name: 'cspc.sid',
    secret: sessionSecret,
    store: new FileStore({ path: path.join(dataDir, 'sessions'), ttl: 86400, retries: 0 }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24
    }
  }));

  const databaseRequest = postgresStore.requestMiddleware();
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && ['/items', '/items/'].includes(req.path)) return next();
    databaseRequest(req, res, next);
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/items', itemRoutes);
  app.use('/api/stats', (req, res) => res.redirect('/api/items/stats'));
  app.use('/uploads', express.static(path.join(dataDir, 'uploads'), { fallthrough: false, maxAge: '7d' }));

  app.get('/admin.html', (req, res) => {
    if (!req.session?.user) return res.redirect('/login?redirect=/admin.html');
    if (req.session.user.role !== 'admin') return res.redirect('/');
    res.sendFile(path.join(__dirname, 'admin.html'));
  });

  app.get(['/browse.html', '/item-detail.html'], (req, res) => res.redirect(302, '/#items'));
  app.get('/report-lost.html', (req, res) => res.redirect(302, '/?report=lost#itemForm'));
  app.get('/report-found.html', (req, res) => res.redirect(302, '/?report=found#itemForm'));
  app.get('/found', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.get('/match-reference', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(['/data', '/routes', '/middleware', '/tests', '/node_modules', '/.git', '/server.js', '/package.json', '/package-lock.json'], (req, res) => res.sendStatus(404));
  app.use(express.static(__dirname));

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
  app.use('/api/*', (req, res) => res.status(404).json({ success: false, message: 'API endpoint not found.' }));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'Image must be 5 MB or smaller.' });
    }
    if (err.name === 'MulterError' || err.status || err.type === 'entity.too.large') {
      return res.status(err.status === 413 || err.type === 'entity.too.large' ? 413 : (err.status || 400))
        .json({ success: false, message: err.message || 'Invalid upload.' });
    }
    if (req.path.startsWith('/api/')) {
      return res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
    }
    console.error('Server error:', err);
    res.status(500).send('An unexpected server error occurred.');
  });

  return app;
}

async function startServer() {
  const PORT = process.env.PORT || 3000;
  if (process.env.NODE_ENV === 'production' || postgresStore.isConfigured()) {
    await postgresStore.initialize();
  }
  await authRoutes.ensureDefaultAdminAccount();
  createApp().listen(PORT, '0.0.0.0', () => console.log(`Server running at: http://localhost:${PORT}`));
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch(error => {
    console.error('Server startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer };
