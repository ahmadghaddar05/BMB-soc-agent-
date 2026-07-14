'use strict';
const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const db      = require('./db');
const routes  = require('./routes');
const scheduler = require('./workers/scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('combined'));
app.use('/api', routes);

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
  await waitForDb();
  await scheduler.start();
  app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
}

main().catch(err => { console.error('[api] fatal:', err); process.exit(1); });
