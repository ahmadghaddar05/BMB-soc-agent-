'use strict';
const express = require('express');
const crypto = require('crypto');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan  = require('morgan');
const db      = require('./db');
const { runMigrations } = require('./db/migrate');
const routes  = require('./routes');
const scheduler = require('./workers/scheduler');
const { authRouter, requireAuth, requireCsrf } = require('./middleware/auth');
const { runtimeConfig, validateStartupConfig } = require('./config');

const PORT = process.env.PORT || 3000;

function createApp() {
  const app = express();
  const config = runtimeConfig();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.id = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 128);
    res.setHeader('X-Request-ID', req.id);
    const originalJson = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 400 && typeof body?.error === 'string') {
        if (res.statusCode >= 500) console.error(`[api] request failed ${req.id}:`, body.error);
        const message = res.statusCode >= 500 ? 'Internal server error' : body.error;
        return originalJson({ error: { code: `HTTP_${res.statusCode}`, message, request_id: req.id } });
      }
      return originalJson(body);
    };
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  if (config.allowedOrigins.length) {
    app.use(cors({ origin: config.allowedOrigins, credentials: true }));
  }
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('combined'));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/chat', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api', authRouter());
  app.use('/api', requireAuth, requireCsrf, routes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use((error, req, res, _next) => {
    console.error(`[api] unhandled request error ${req.id}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

const app = createApp();

// ── Wait for DB, then start ───────────────────────────────────────────────
async function waitForDb(retries = 15, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await db.query('SELECT 1');
      console.log('[api] database connection OK');
      return;
    } catch (e) {
      console.warn(`[api] waiting for DB (attempt ${i+1}/${retries}):`, e.message);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Could not connect to database after retries');
}

async function main() {
  const validation = validateStartupConfig();
  for (const warning of validation.warnings) console.warn(`[config] ${warning}`);
  if (!validation.ok) throw new Error(`Invalid configuration: ${validation.errors.join('; ')}`);
  await waitForDb();
  await runMigrations(db);
  await scheduler.start();
  app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
}

if (require.main === module) {
  main().catch(err => { console.error('[api] fatal:', err); process.exit(1); });
}

module.exports = { app, createApp, main, waitForDb };
