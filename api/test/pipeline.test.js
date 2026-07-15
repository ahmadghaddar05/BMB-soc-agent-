'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { mapWithConcurrency, runCycle } = require('../src/workers/pipeline');

test('bounded concurrency preserves result order and respects its cap', async () => {
  let active = 0;
  let peak = 0;
  const values = Array.from({ length:20 }, (_, index) => index);
  const result = await mapWithConcurrency(values, 4, async value => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  assert.deepEqual(result, values.map(value => value * 2));
  assert.ok(peak <= 4);
  assert.ok(peak > 1);
});

test('mock collection and enrichment complete with AI disabled and zero AI usage', async () => {
  const originals = {
    getAllSettings:db.getAllSettings, startFetchRun:db.startFetchRun,
    finishFetchRun:db.finishFetchRun, query:db.query, fetch:globalThis.fetch,
    alertSource:process.env.ALERT_SOURCE, wazuhMode:process.env.WAZUH_MODE,
  };
  const pending = [];
  let finished;
  try {
    process.env.ALERT_SOURCE = 'mock';
    process.env.WAZUH_MODE = 'mock';
    db.getAllSettings = async () => ({ triage_enabled:'false', lookback_minutes:'15', min_level:'0', limit:'20' });
    db.startFetchRun = async () => 42;
    db.finishFetchRun = async (id, stats, status, error) => { finished = { id, stats, status, error }; };
    db.query = async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('INSERT INTO alerts')) {
        pending.push({ id:params[0], timestamp:params[1], src_ip:params[10], dst_ip:params[11], username:params[12], hostname:params[13] });
        return { rows:[], rowCount:1 };
      }
      if (text.includes("FROM alerts WHERE enrichment_status='pending'")) return { rows:[...pending] };
      if (text.includes("enrichment_status='enriched'")) return { rows:[], rowCount:1 };
      throw new Error(`Unexpected mock pipeline query: ${text.slice(0, 80)}`);
    };
    globalThis.fetch = async () => new Response(JSON.stringify({ context:{ source:'test-enrichment' } }), {
      status:200, headers:{ 'Content-Type':'application/json' },
    });

    const result = await runCycle('manual');
    assert.equal(result.stats.fetched, 4);
    assert.equal(result.stats.stored, 4);
    assert.equal(result.stats.enriched, 4);
    assert.equal(result.stats.llm_calls, 0);
    assert.equal(result.stats.llm_tokens, 0);
    assert.deepEqual(finished, { id:42, stats:result.stats, status:'ok', error:undefined });
  } finally {
    Object.assign(db, {
      getAllSettings:originals.getAllSettings, startFetchRun:originals.startFetchRun,
      finishFetchRun:originals.finishFetchRun, query:originals.query,
    });
    globalThis.fetch = originals.fetch;
    if (originals.alertSource === undefined) delete process.env.ALERT_SOURCE;
    else process.env.ALERT_SOURCE = originals.alertSource;
    if (originals.wazuhMode === undefined) delete process.env.WAZUH_MODE;
    else process.env.WAZUH_MODE = originals.wazuhMode;
  }
});
