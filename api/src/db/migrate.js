'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
}

async function runMigrations(db, logger = console) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bmb_soc_schema_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map(row => row.version));

    for (const filename of migrationFiles()) {
      if (applied.has(filename)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [filename]);
      logger.info(`[db] applied migration ${filename}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`Database migration failed: ${error.message || String(error)}`);
  } finally {
    client.release();
  }
}

module.exports = { MIGRATIONS_DIR, migrationFiles, runMigrations };
