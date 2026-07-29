'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:test@localhost/unused';

const db = require('../src/db');
const {
  CONFIRMATION,
  policyFromSettings,
  previewRetention,
  runRetention,
} = require('../src/services/alert-retention');

const originalQuery = db.query;
const originalConnect = db.connect;
const originalSettings = db.getAllSettings;

test.afterEach(() => {
  db.query = originalQuery;
  db.connect = originalConnect;
  db.getAllSettings = originalSettings;
});

test('retention policy defaults to critical 14 days, high 10 days, and other 7 days', () => {
  assert.deepEqual(policyFromSettings({}), {
    enabled:false,
    critical_days:14,
    high_days:10,
    default_days:7,
    batch_size:5000,
    schedule:'17 2 * * *',
    schedule_timezone:'UTC',
    elastic_source_affected:false,
  });
});

test('retention preview is severity-aware and protects durable workflow evidence', async () => {
  db.getAllSettings = async () => ({
    alert_retention_critical_days:'14',
    alert_retention_high_days:'10',
    alert_retention_default_days:'7',
  });
  let sql = '';
  let params = null;
  db.query = async (text, values) => {
    sql = String(text);
    params = values;
    return {
      rows:[
        { severity:'critical', protected:false, count:8 },
        { severity:'critical', protected:true, count:2 },
        { severity:'high', protected:false, count:5 },
      ],
    };
  };

  const result = await previewRetention({ mode:'policy' });
  assert.deepEqual(params, [14, 10, 7]);
  assert.match(sql, /investigation_alerts/);
  assert.match(sql, /incidents/);
  assert.match(sql, /simulated_response_states/);
  assert.match(sql, /\$1::integer/);
  assert.match(sql, /\$2::integer/);
  assert.match(sql, /\$3::integer/);
  assert.match(sql, /INTERVAL '1 day'/);
  assert.equal(result.candidates.total, 15);
  assert.equal(result.protected.total, 2);
  assert.equal(result.deletable.total, 13);
});

test('destructive retention refuses to connect without exact confirmation', async () => {
  let connected = false;
  db.connect = async () => {
    connected = true;
    throw new Error('must not connect');
  };
  await assert.rejects(
    runRetention({ mode:'initial_7_day_purge', confirmation:'delete' }),
    error => error.code === 'RETENTION_CONFIRMATION_REQUIRED'
  );
  assert.equal(connected, false);
  assert.equal(CONFIRMATION, 'PURGE DASHBOARD ALERTS');
});
