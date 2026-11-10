const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { ADMIN_DIR, FRONTEND_DIR } = require('./paths');

// `npm run admin` passes --admin: default to development so the panel can turn on.
const ADMIN_FLAG = process.argv.includes('--admin');
if (ADMIN_FLAG && !process.env.NODE_ENV) process.env.NODE_ENV = 'development';

const isProduction = process.env.NODE_ENV === 'production';
// The panel needs all three: `npm run admin` (--admin), a password, and a
// non-production environment. A stray ADMIN_PASSWORD on a host can't enable it.
const adminEnabled = ADMIN_FLAG && Boolean(process.env.ADMIN_PASSWORD) && !isProduction;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const corsMiddleware = cors({
  // Requests without an Origin header (curl, server-to-server) are allowed;
  // browsers from other origins get no CORS headers and are blocked.
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Accept'],
  maxAge: 600,
});

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Render (and most hosts) sit behind one proxy; needed for per-IP rate limits.
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
  app.use(helmet());

  const api = express.Router();
  api.use(corsMiddleware);
  api.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
  api.use('/contact', require('./routes/contact'));
  api.use('/projects', require('./routes/projects'));
  app.use('/api', api);

  if (adminEnabled) {
    app.use('/api/admin', require('./routes/admin'));
    app.use('/admin', express.static(ADMIN_DIR));
    // Preview of the static site. It uses inline onclick handlers and calls the
    // API on localhost, so its CSP is relaxed compared to the rest of the app.
    app.use(
      '/site',
      helmet.contentSecurityPolicy({
        directives: {
          scriptSrcAttr: ["'unsafe-inline'"],
          connectSrc: ["'self'", 'http://localhost:*', 'http://127.0.0.1:*'],
        },
      }),
      express.static(FRONTEND_DIR),
    );
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}

if (require.main === module) {
  if (ADMIN_FLAG && !adminEnabled) {
    console.error(
      isProduction
        ? 'The admin panel is disabled when NODE_ENV=production.'
        : 'Set ADMIN_PASSWORD in backend/.env to use the admin panel (see .env.example).',
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT || 5000);
  // With the admin panel on, only accept connections from this machine.
  const host = adminEnabled ? '127.0.0.1' : undefined;
  createApp().listen(port, host, () => {
    console.log(`API listening on http://localhost:${port}`);
    if (adminEnabled) {
      console.log(`Admin panel:  http://localhost:${port}/admin`);
      console.log(`Site preview: http://localhost:${port}/site/`);
    }
  });
}

module.exports = { createApp };
