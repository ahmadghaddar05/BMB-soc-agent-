'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../src');

async function withServer(run) {
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('health reports loaded dataset counts', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.counts.ad_users, 100);
  });
});

test('composite enrichment returns known AD, TIP, and CMDB context', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/enrich`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        username:'rami.haddad', src_ip:'185.220.101.45',
        dst_ip:'10.20.0.22', hostname:'DC01.bank.local',
        timestamp:new Date().toISOString(),
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.context.user.samAccountName, 'rami.haddad');
    assert.equal(body.context.src_threat_intel.found, true);
    assert.equal(body.context.dst_asset.hostname, 'DC01.bank.local');
  });
});
