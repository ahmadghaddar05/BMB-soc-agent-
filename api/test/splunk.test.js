'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  buildSearchClauses,
  checkHealth,
  fetchAlerts,
  normalizeAlert,
  parseRawKeyValueFields,
  parseExportResponse,
  searchEvents,
  validateConfiguration,
} = require('../src/services/splunk');

function withSplunkEnvironment(url, fn) {
  const keys = [
    'SPLUNK_URL', 'SPLUNK_TOKEN', 'SPLUNK_INDEX', 'SPLUNK_SEARCH',
    'SPLUNK_AUTH_SCHEME', 'SPLUNK_VERIFY_TLS', 'SPLUNK_CA_CERT',
  ];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SPLUNK_URL:url,
    SPLUNK_TOKEN:'test-token',
    SPLUNK_INDEX:'security',
    SPLUNK_SEARCH:'search index=security',
    SPLUNK_AUTH_SCHEME:'Bearer',
    SPLUNK_VERIFY_TLS:'true',
    SPLUNK_CA_CERT:'',
  });
  return Promise.resolve().then(fn).finally(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
}

async function testServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { return await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('Splunk configuration validates URL, token, index, and authentication scheme', () => {
  assert.throws(() => validateConfiguration({}), /SPLUNK_URL is not set/);
  assert.throws(() => validateConfiguration({ SPLUNK_URL:'https://10.1.1.160:8089' }), /SPLUNK_TOKEN is not set/);
  assert.throws(() => validateConfiguration({
    SPLUNK_URL:'https://10.1.1.160:8089', SPLUNK_TOKEN:'x', SPLUNK_INDEX:'bad index',
  }), /SPLUNK_INDEX contains invalid characters/);
  assert.throws(() => validateConfiguration({
    SPLUNK_URL:'https://10.1.1.160:8089', SPLUNK_TOKEN:'x', SPLUNK_AUTH_SCHEME:'Basic',
  }), /SPLUNK_AUTH_SCHEME must be Bearer or Splunk/);
});

test('Splunk normalization maps textual urgency and common CIM fields', () => {
  const alert = normalizeAlert({
    _time:'1785400483.5', _cd:'security~4~ABC', index:'security', urgency:'critical',
    search_name:'Suspicious PowerShell', user:'maya.georges', host:'HR-WS001',
    src:'198.51.100.24', dest:'10.1.1.20', process_name:'powershell.exe',
    mitre_attack_id:'T1059.001,T1105', _raw:'powershell test event',
  });
  assert.equal(alert.rule_level, 15);
  assert.equal(alert.source_severity, 'critical');
  assert.equal(alert.rule_desc, 'Suspicious PowerShell');
  assert.equal(alert.username, 'maya.georges');
  assert.equal(alert.hostname, 'HR-WS001');
  assert.deepEqual(alert.mitre_techniques, ['T1059.001', 'T1105']);
  assert.match(alert.id, /^splunk:[a-f0-9]{64}$/);
  assert.match(alert.timestamp, /^2026-/);
  assert.equal(alert.risk_score, null);
});

test('Splunk audit alert_fired records expose the saved-search context embedded in _raw', () => {
  const raw = 'Audit:[timestamp=08-10-2026 14:43:15.607, user=cybersec, action=alert_fired, ss_user="cybersec", ss_app="cisco_ios", ss_name="bmb - port flapping", sid="rt_scheduler_test", severity=3, triggered_alerts=1]';
  const parsed = parseRawKeyValueFields(raw);
  assert.equal(parsed.ss_name, 'bmb - port flapping');
  assert.equal(parsed.ss_app, 'cisco_ios');

  const alert = normalizeAlert({
    _cd:'69:93294013', _time:'2026-08-10T11:43:15.607Z', index:'_audit',
    host:'lbspshi', source:'audittrail', sourcetype:'audittrail', action:'alert_fired', _raw:raw,
  });
  assert.equal(alert.rule_desc, 'BMB - Port flapping');
  assert.equal(alert.rule_id, 'bmb - port flapping');
  assert.equal(alert.rule_level, 8);
  assert.equal(alert.source_severity, 'medium');
  assert.equal(alert.username, 'cybersec');
  assert.equal(alert.hostname, 'lbspshi');
  assert.equal(alert.event_dataset, 'splunk.alert');
  assert.equal(alert.event_action, 'alert_fired');
  assert.deepEqual(alert.rule_groups, ['splunk_alert', 'cisco_ios']);
  assert.match(alert.alert_reason, /Port flapping.*cisco_ios.*cybersec.*1 triggered result/);
  assert.equal(alert.raw.ss_name, 'bmb - port flapping');
});

test('Splunk identifiers remain stable when a source event has no timestamp', () => {
  const source = { index:'security', host:'DB01', _raw:'timestamp-free event' };
  assert.equal(normalizeAlert(source).id, normalizeAlert(source).id);
});

test('Splunk export parser fails visibly on malformed records and API search errors', () => {
  assert.throws(() => parseExportResponse('{not json}\n'), /malformed JSON/);
  assert.throws(() => parseExportResponse(JSON.stringify({
    messages:[{ type:'ERROR', text:'Search is not authorized' }],
  })), /Search is not authorized/);
});

test('Splunk collection uses the export API, token auth, and request-level time bounds', async () => {
  let requestBody = '';
  await testServer((req, res) => {
    assert.equal(req.url, '/services/search/jobs/export');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    req.setEncoding('utf8');
    req.on('data', chunk => { requestBody += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(`${JSON.stringify({ result:{
        _time:'2026-07-30T08:00:00Z', _cd:'security~1~A', index:'security',
        severity:'high', signature:'Credential access', _raw:'event one',
      } })}\n`);
    });
  }, url => withSplunkEnvironment(url, async () => {
    const alerts = await fetchAlerts({ minutes:30, limit:10 });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].rule_level, 12);
    const form = new URLSearchParams(requestBody);
    assert.equal(form.get('earliest_time'), '-30m');
    assert.equal(form.get('latest_time'), 'now');
    assert.equal(form.get('count'), '10');
    assert.equal(form.get('search'), 'search index=security | head 10');
    assert.doesNotMatch(form.get('search'), /earliest_time/);
  }));
});

test('Splunk raw-event pivots append filters after a custom search pipeline', async () => {
  let requestBody = '';
  await testServer((req, res) => {
    req.setEncoding('utf8');
    req.on('data', chunk => { requestBody += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(`${JSON.stringify({ result:{
        _time:'2026-07-30T08:00:00Z', _cd:'security~1~B', index:'security',
        user:'maya.georges', 'process.name':'powershell.exe', _raw:'pivot event',
      } })}\n`);
    });
  }, url => withSplunkEnvironment(url, async () => {
    process.env.SPLUNK_SEARCH = 'search index=security | fields _time user host process.name _raw';
    const events = await searchEvents({ username:'maya.georges', hours:12, limit:5 });
    assert.equal(events.length, 1);
    const form = new URLSearchParams(requestBody);
    assert.equal(form.get('earliest_time'), '-12h');
    assert.match(form.get('search'), /\| fields .* \| search \(user="maya\.georges" OR user\.name="maya\.georges"\) \| head 5$/);
  }));
});

test('Splunk health verifies authentication context without exposing the token', async () => {
  await testServer((req, res) => {
    assert.equal(req.url, '/services/authentication/current-context?output_mode=json');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end(JSON.stringify({ entry:[{ content:{ username:'bmb_reader' } }] }));
  }, url => withSplunkEnvironment(url, async () => {
    const health = await checkHealth();
    assert.equal(health.status, 'online');
    assert.equal(health.authenticated_user, 'bmb_reader');
    assert.equal(health.index, 'security');
    assert.equal(Object.values(health).includes('test-token'), false);
  }));
});

test('Splunk health reports disabled certificate verification as degraded', async () => {
  await testServer((req, res) => {
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end(JSON.stringify({ entry:[{ content:{ username:'bmb_reader' } }] }));
  }, url => withSplunkEnvironment(url, async () => {
    process.env.SPLUNK_VERIFY_TLS = 'false';
    const health = await checkHealth();
    assert.equal(health.status, 'degraded');
    assert.equal(health.reachable, true);
    assert.equal(health.tls_verified, false);
  }));
});

test('Splunk pivot values are escaped as SPL string literals', () => {
  const clauses = buildSearchClauses({ username:'user" OR index=*', source_ip:'198.51.100.24' });
  assert.match(clauses[0], /user\\" OR index=\*/);
  assert.equal(clauses[1], '(source.ip="198.51.100.24" OR src="198.51.100.24" OR src_ip="198.51.100.24" OR clientip="198.51.100.24")');
});
