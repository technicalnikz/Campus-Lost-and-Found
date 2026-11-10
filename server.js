// server.js - CSPC Lost & Found Management System (Node.js & Express)
// Hostinger injects production variables directly; load .env only for local development.
if (!['test', 'production'].includes(process.env.NODE_ENV)) require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

const crypto = require('crypto');

const authRoutes = require('./routes/authRoutes');
const itemRoutes = require('./routes/itemRoutes');
const postgresStore = require('./services/postgresStore');

// Browser assets referenced by the HTML pages, mapped to their files on disk.
function assetFile(urlPath) {
  if (urlPath === '/icons.js') return path.join(__dirname, 'icons.js');
  if (urlPath === '/vendor/qrcode.js') return require.resolve('qrcode-generator/qrcode.js');
  const match = /^\/(css|js)\/([\w.-]+)$/.exec(urlPath);
  return match ? path.join(__dirname, match[1], match[2]) : null;
}

// Files only change on deploy (which restarts the app) in production; during
// development, re-read them on every request so edits show up immediately.
const cacheAssetInfo = () => process.env.NODE_ENV === 'production';

const assetVersions = new Map();
function assetVersion(urlPath) {
  if (!cacheAssetInfo() || !assetVersions.has(urlPath)) {
    const file = assetFile(urlPath);
    let version = null;
    try {
      version = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    } catch {
      // Unknown or missing asset: leave its URL unversioned.
    }
    assetVersions.set(urlPath, version);
  }
  return assetVersions.get(urlPath);
}

// Stamp every CSS/JS link with a hash of its contents so browsers fetch new files
// after each deploy without anyone editing ?v= tags by hand.
const pageCache = new Map();
function sendPage(res, file) {
  if (!cacheAssetInfo() || !pageCache.has(file)) {
    const html = fs.readFileSync(file, 'utf8').replace(
      /(src|href)="(\/(?:css|js|vendor)\/[\w.-]+|\/icons\.js)(?:\?v=[^"]*)?"/g,
      (whole, attr, urlPath) => {
        const version = assetVersion(urlPath);
        return version ? `${attr}="${urlPath}?v=${version}"` : whole;
      }
    );
    pageCache.set(file, html);
  }
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(pageCache.get(file));
}

// Versioned asset URLs never change content, so they can be cached for a year.
function setAssetCacheHeaders(res) {
  res.set('Cache-Control', res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
}

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

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // Location only for this site's own pages: the handover meetup asks for one reading
      // when a student agrees to share it. Embedded frames can never ask.
      'Permissions-Policy': 'geolocation=(self), microphone=()',
      // Scripts only from this site (no inline code or handlers); inline style
      // attributes are still used by some markup. QR codes and photo previews use data:/blob: images.
      // OpenStreetMap tiles draw the small map of a shared meetup location.
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://tile.openstreetmap.org",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ].join('; ')
    });
    if (isProduction) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });

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

  const page = name => path.join(__dirname, 'public', name);

  app.get('/admin.html', (req, res) => {
    if (!req.session?.user) return res.redirect('/login?redirect=/admin.html');
    if (req.session.user.role !== 'admin') return res.redirect('/');
    sendPage(res, path.join(__dirname, 'admin.html'));
  });

  app.get(['/browse.html', '/item-detail.html'], (req, res) => res.redirect(302, '/#items'));
  app.get('/report-lost.html', (req, res) => res.redirect(302, '/?report=lost#itemForm'));
  app.get('/report-found.html', (req, res) => res.redirect(302, '/?report=found#itemForm'));
  app.get(['/found', '/match-reference', '/index.html'], (req, res) => sendPage(res, page('index.html')));
  app.get('/', (req, res) => {
    if (req.session?.user?.role === 'admin') return res.redirect(302, '/admin.html');
    sendPage(res, page('index.html'));
  });
  app.get('/login', (req, res) => {
    const user = req.session?.user;
    if (user?.role === 'admin') return res.redirect(302, '/admin.html');
    if (user?.role === 'student') return res.redirect(302, '/');
    sendPage(res, page('login.html'));
  });
  app.get(['/login.html', '/about.html'], (req, res) => sendPage(res, page(path.basename(req.path))));

  app.use(express.static(path.join(__dirname, 'public')));
  // Serve only browser assets from the project root; server code, scripts and data stay private.
  app.use('/css', express.static(path.join(__dirname, 'css'), { setHeaders: setAssetCacheHeaders }));
  app.use('/js', express.static(path.join(__dirname, 'js'), { setHeaders: setAssetCacheHeaders }));
  app.get(['/icons.js', '/vendor/qrcode.js'], (req, res) => {
    setAssetCacheHeaders(res);
    res.sendFile(assetFile(req.path));
  });

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
  const app = createApp();
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running at: http://localhost:${PORT}`));

  // Bind the port before remote database setup so managed hosts can detect
  // the application within their startup timeout.
  try {
    if (process.env.NODE_ENV === 'production' || postgresStore.isConfigured()) {
      await postgresStore.initialize();
    }
    await authRoutes.ensureDefaultAdminAccount();
  } catch (error) {
    server.close(() => {});
    throw error;
  }
  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch(error => {
    console.error('Server startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer };
