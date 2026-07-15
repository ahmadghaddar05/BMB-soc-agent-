'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '..', 'data');
const load = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));

// ── Load data once at startup ─────────────────────────────────────────────
const AD_USERS   = Object.fromEntries(load('ad_users.json').map(u => [u.samAccountName, u]));
const AD_GROUPS  = Object.fromEntries(load('ad_groups.json').map(g => [g.name, g]));
const CMDB_LIST  = load('cmdb_assets.json');
const CMDB_HOST  = Object.fromEntries(CMDB_LIST.map(a => [a.hostname, a]));
const CMDB_IP    = (() => {
  const m = {};
  CMDB_LIST.forEach(a => { if (!m[a.ip_address]) m[a.ip_address] = a; });
  return m;
})();
const EDR_AGENTS = Object.fromEntries(load('edr_agents.json').map(a => [a.hostname, a]));
const EDR_DETS   = load('edr_detections.json');
const TIP_IND    = Object.fromEntries(load('tip_indicators.json').map(i => [i.value, i]));
const VULN_LIST  = load('vuln_findings.json');

console.log(`[enrichment] Loaded: ${Object.keys(AD_USERS).length} AD users, ` +
  `${CMDB_LIST.length} CMDB assets, ${Object.keys(EDR_AGENTS).length} EDR agents, ` +
  `${EDR_DETS.length} detections, ${Object.keys(TIP_IND).length} TIP indicators, ` +
  `${VULN_LIST.length} vuln findings`);

const app = express();
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status: 'ok',
  counts: {
    ad_users:    Object.keys(AD_USERS).length,
    cmdb_assets: CMDB_LIST.length,
    edr_agents:  Object.keys(EDR_AGENTS).length,
    edr_dets:    EDR_DETS.length,
    tip:         Object.keys(TIP_IND).length,
    vuln:        VULN_LIST.length,
  }
}));

// ── AD ────────────────────────────────────────────────────────────────────
app.get('/ad/users/:sam', (req, res) => {
  const u = AD_USERS[req.params.sam];
  if (!u) return res.status(404).json({ error: `User '${req.params.sam}' not in directory` });
  res.json(u);
});

app.post('/ad/logon-check', (req, res) => {
  const { sam, src_ip, timestamp } = req.body;
  const user = AD_USERS[sam];
  if (!user) return res.json({ verdict: 'unknown_user', anomalies: ['user_not_in_directory'] });

  const anomalies = [];
  const details   = {};

  if (user.logonHours && timestamp) {
    try {
      const hour = new Date(timestamp).getUTCHours();
      const [start, end] = user.logonHours;
      if (hour < start || hour >= end) {
        anomalies.push('outside_normal_hours');
        details.hour = hour;
        details.normal_hours = user.logonHours;
      }
    } catch (_) {}
  }

  if (user.homeSubnet && src_ip) {
    const [netAddr, prefix] = user.homeSubnet.split('/');
    const mask = prefix ? parseInt(prefix) : 24;
    const toInt = ip => ip.split('.').reduce((a,o) => (a<<8)+parseInt(o), 0) >>> 0;
    const m = (0xFFFFFFFF << (32-mask)) >>> 0;
    if ((toInt(src_ip) & m) !== (toInt(netAddr) & m)) {
      anomalies.push('source_outside_home_subnet');
      details.home_subnet = user.homeSubnet;
    }
  }

  if (!user.accountEnabled) anomalies.push('disabled_account');
  if (!user.mfaRegistered)  details.mfa_warning = 'MFA not registered';

  res.json({
    verdict:          anomalies.length >= 2 ? 'suspicious' : anomalies.length ? 'low_risk' : 'normal',
    anomalies,
    details,
    user_privilege:   user.privilegeTier,
    user_criticality: user.criticalityTier,
  });
});

// ── CMDB ──────────────────────────────────────────────────────────────────
app.get('/cmdb/by-hostname/:hostname', (req, res) => {
  const a = CMDB_HOST[req.params.hostname];
  if (!a) return res.status(404).json({ error: `Asset '${req.params.hostname}' not in CMDB` });
  res.json(a);
});

app.get('/cmdb/by-ip/:ip', (req, res) => {
  const a = CMDB_IP[req.params.ip];
  if (!a) return res.status(404).json({ error: `No CMDB record for IP ${req.params.ip}` });
  res.json(a);
});

// ── EDR ───────────────────────────────────────────────────────────────────
app.get('/edr/agent/:hostname', (req, res) => {
  const a = EDR_AGENTS[req.params.hostname];
  if (!a) return res.status(404).json({ error: `No EDR agent on '${req.params.hostname}'` });
  res.json(a);
});

app.get('/edr/detections/:hostname', (req, res) => {
  const hours = parseInt(req.query.hours || '48');
  const cutoff = new Date(Date.now() - hours * 3600000);
  const dets = EDR_DETS
    .filter(d => d.hostname === req.params.hostname && new Date(d.timestamp) >= cutoff)
    .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  const bySev = dets.reduce((acc, d) => { acc[d.severity] = (acc[d.severity]||0)+1; return acc; }, {});
  res.json({ hostname: req.params.hostname, total: dets.length, by_severity: bySev, detections: dets,
             agent_present: req.params.hostname in EDR_AGENTS });
});

// ── TIP ───────────────────────────────────────────────────────────────────
app.get('/tip/:value', (req, res) => {
  const rec = TIP_IND[req.params.value];
  if (!rec) return res.json({ value: req.params.value, found: false, verdict: 'no_known_threat' });
  res.json({ found: true, ...rec });
});

app.post('/tip/bulk', (req, res) => {
  const values = req.body.values || [];
  res.json({
    results: values.map(v => TIP_IND[v]
      ? { value: v, found: true, ...TIP_IND[v] }
      : { value: v, found: false, verdict: 'no_known_threat' })
  });
});

// ── Vuln ──────────────────────────────────────────────────────────────────
app.get('/vuln/:hostname/risk', (req, res) => {
  const items = VULN_LIST.filter(f => f.hostname === req.params.hostname);
  if (!items.length) return res.json({ hostname: req.params.hostname, vuln_records_present: false });
  const open = items.filter(f => ['open','in_remediation'].includes(f.state));
  const bySev = open.reduce((a,f) => { a[f.severity]=(a[f.severity]||0)+1; return a; }, {});
  const exploitable = open.filter(f => f.exploit_available).length;
  const maxCvss = Math.max(0, ...open.map(f => f.cvss_score||0));
  res.json({ hostname: req.params.hostname, vuln_records_present: true,
             total_open: open.length, by_severity: bySev, exploitable_count: exploitable, max_cvss: maxCvss });
});

// ─────────────────────────────────────────────────────────────────────────
// Composite: enrich one alert with all 5 sources in a single call
// This is the main endpoint the API worker calls
// ─────────────────────────────────────────────────────────────────────────
app.post('/enrich', (req, res) => {
  const { src_ip, username, hostname, dst_ip, timestamp } = req.body;
  const ctx = {};

  if (username) {
    const u = AD_USERS[username];
    ctx.user = u || null;
    if (u && src_ip && timestamp) {
      // inline logon check
      const anomalies = [];
      if (u.logonHours && timestamp) {
        const hour = new Date(timestamp).getUTCHours();
        const [s,e] = u.logonHours;
        if (hour < s || hour >= e) anomalies.push('outside_normal_hours');
      }
      if (u.homeSubnet && src_ip) {
        const toInt = ip => ip.split('.').reduce((a,o)=>(a<<8)+parseInt(o),0)>>>0;
        const [net,pfx] = u.homeSubnet.split('/');
        const m = (0xFFFFFFFF<<(32-(parseInt(pfx)||24)))>>>0;
        if ((toInt(src_ip)&m)!==(toInt(net)&m)) anomalies.push('source_outside_home_subnet');
      }
      if (!u.accountEnabled) anomalies.push('disabled_account');
      ctx.logon_check = {
        verdict: anomalies.length>=2?'suspicious':anomalies.length?'low_risk':'normal',
        anomalies,
        mfa_registered: u.mfaRegistered||false,
      };
    }
  }

  if (src_ip) {
    ctx.src_threat_intel = TIP_IND[src_ip] ? { found:true, ...TIP_IND[src_ip] }
                                             : { found:false, verdict:'no_known_threat' };
    ctx.src_asset = CMDB_IP[src_ip] || null;
  }

  // Target host resolution: hostname → CMDB → EDR → Vuln
  let targetHost = hostname;
  if (!targetHost && dst_ip) {
    const a = CMDB_IP[dst_ip];
    if (a) { targetHost = a.hostname; ctx.dst_asset = a; }
  }
  if (targetHost) {
    if (!ctx.dst_asset) ctx.dst_asset = CMDB_HOST[targetHost] || null;
    ctx.edr_agent   = EDR_AGENTS[targetHost] || null;

    const cutoff = new Date(Date.now() - 48*3600000);
    const dets = EDR_DETS
      .filter(d => d.hostname === targetHost && new Date(d.timestamp) >= cutoff)
      .sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
    ctx.edr_recent = { total: dets.length,
      by_severity: dets.reduce((a,d)=>{a[d.severity]=(a[d.severity]||0)+1;return a;},{}),
      detections: dets.slice(0,5) };

    const vulnItems = VULN_LIST.filter(f=>f.hostname===targetHost && ['open','in_remediation'].includes(f.state));
    ctx.vuln_risk = vulnItems.length ? {
      present: true, total_open: vulnItems.length,
      exploitable: vulnItems.filter(f=>f.exploit_available).length,
      max_cvss: Math.max(0,...vulnItems.map(f=>f.cvss_score||0)),
      by_severity: vulnItems.reduce((a,f)=>{a[f.severity]=(a[f.severity]||0)+1;return a;},{})
    } : { present: false };
  }

  res.json({ ok: true, context: ctx });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`[enrichment] listening on :${PORT}`));
}

module.exports = { app };
