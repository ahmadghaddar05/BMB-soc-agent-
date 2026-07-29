'use strict';

const db = require('../db');
const { runRetention } = require('../services/alert-retention');

async function main() {
  const command = process.argv[2];
  const mode = process.argv[3] || 'policy';
  if (!['preview','run'].includes(command)) {
    throw new Error('Usage: node src/scripts/alert-retention.js <preview|run> <policy|initial_7_day_purge>');
  }
  const result = await runRetention({
    mode,
    dryRun:command === 'preview',
    confirmation:process.env.ALERT_RETENTION_CONFIRMATION,
    actor:'system:server-cli',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
