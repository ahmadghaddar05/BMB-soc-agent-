'use strict';
const https = require('https');

// Set TLS bypass at process level if Wazuh cert verification is disabled
if (process.env.WAZUH_VERIFY_TLS === 'false') {
}

function extractEntities(src) {
  const d   = src.data || {};
  const win = d.win?.eventdata || {};
  const first = (...arr) => arr.find(v => v && typeof v === 'string' && v.trim() && v !== '-') || null;

  const hostname = first(
    win.computer,
    d.hostname,
    d.win?.system?.computer,
    d.dsthost,
    ...(src.agent?.name && (
      src.agent.name.includes('.') ||
      src.agent.name.match(/^(DC|SQL|WS|COREBANK|SWIFT|IBANK|MYSQL|MOBILE|FILE|MAIL|BACKUP|LOAN|CARDS|T24)/i)
    ) ? [src.agent.name] : []),
  );

  return {
    src_ip:    first(d.srcip, d.src_ip, win.ipAddress, win.ipaddress, d.network?.src_ip),
    dst_ip:    first(d.dstip, d.dst_ip, win.destinationIp),
    username:  first(d.dstuser, d.srcuser, win.targetUserName, win.targetusername, win.subjectUserName),
    hostname,
    process:   first(win.image, win.processName, d.process?.name),
    target_db: (() => {
      const log = src.full_log || '';
      const m = log.match(/(?:USE\s+|DATABASE[:\s]+)([A-Z_]{4,})/i);
      if (m) return m[1].toUpperCase();
      const dbs = ['CORE_BANKING','CARDS_PROD','PAYMENTS','TREASURY_POS',
                   'AML_CASES','LOAN_ORIG','CUSTOMER_360'];
      return dbs.find(db => log.toUpperCase().includes(db)) || null;
    })(),
  };
}

function normalizeAlert(hit) {
  const s = hit._source || {};
  const rule = s.rule || {};
  return {
    id:          hit._id,
    timestamp:   s['@timestamp'] || s.timestamp || new Date().toISOString(),
    rule_id:     String(rule.id || ''),
    rule_level:  parseInt(rule.level || 0, 10),
    rule_desc:   rule.description || rule.comment || '',
    rule_groups: Array.isArray(rule.groups) ? rule.groups : [],
    decoder:     s.decoder?.name || null,
    agent_id:    s.agent?.id || null,
    agent_name:  s.agent?.name || null,
    full_log:    s.full_log || null,
    ...extractEntities(s),
    ...extractMitre(s),
    raw: s,
  };
}

// ── MITRE ATT&CK mapping ───────────────────────────────────────────────────
// Wazuh's own rulesets tag alerts with rule.mitre.{id,tactic,technique}. We use
// that when present; otherwise we fall back to a small heuristic over rule
// groups so alerts still get a tactic/technique even on rulesets without MITRE.
const TECHNIQUE_TACTIC = {
  T1110: 'credential_access',  // Brute Force
  T1078: 'initial_access',     // Valid Accounts
  T1059: 'execution',          // Command/Scripting Interpreter
  T1021: 'lateral_movement',   // Remote Services
  T1003: 'credential_access',  // OS Credential Dumping
  T1190: 'initial_access',     // Exploit Public-Facing Application
  T1486: 'impact',             // Data Encrypted for Impact (ransomware)
  T1071: 'command_and_control',
  T1567: 'exfiltration',       // Exfil over web service
  T1098: 'persistence',        // Account Manipulation
};
const GROUP_TECHNIQUE = [
  [/brute.?force|authentication_fail|sshd|win_authentication_failed/i, 'T1110'],
  [/sql.?injection|web_attack|attack|exploit/i,                        'T1190'],
  [/privilege_escalation|sudo|runas/i,                                 'T1078'],
  [/ransomware|crypto/i,                                               'T1486'],
  [/lateral|psexec|wmi|smb/i,                                          'T1021'],
  [/mimikatz|lsass|credential/i,                                       'T1003'],
  [/command|powershell|script/i,                                       'T1059'],
];

function extractMitre(src) {
  const m = src.rule?.mitre || {};
  let techniques = Array.isArray(m.id) ? m.id.slice() : (m.id ? [m.id] : []);
  let tactics    = Array.isArray(m.tactic) ? m.tactic.slice() : (m.tactic ? [m.tactic] : []);

  // Fallback: derive a technique from rule groups / description when Wazuh
  // didn't tag the alert.
  if (!techniques.length) {
    const hay = [...(src.rule?.groups || []), src.rule?.description || ''].join(' ');
    for (const [re, tech] of GROUP_TECHNIQUE) {
      if (re.test(hay)) { techniques = [tech]; break; }
    }
  }
  // Normalise tactic names to our snake_case set, and backfill from techniques.
  const norm = t => String(t).toLowerCase().trim().replace(/[\s-]+/g, '_');
  tactics = tactics.map(norm);
  if (!tactics.length) {
    tactics = [...new Set(techniques.map(t => TECHNIQUE_TACTIC[String(t).toUpperCase()]).filter(Boolean))];
  }
  return {
    mitre_techniques: [...new Set(techniques.map(t => String(t).toUpperCase()))],
    mitre_tactics:    [...new Set(tactics)],
  };
}

async function fetchFromWazuh({ minutes = 15, minLevel = 7, limit = 200 } = {}) {
  const url   = (process.env.WAZUH_INDEXER_URL || '').replace(/\/$/, '');
  const user  = process.env.WAZUH_INDEXER_USER || 'admin';
  const pass  = process.env.WAZUH_INDEXER_PASS || '';
  const index = process.env.WAZUH_INDEX || 'wazuh-alerts-*';

  if (!url) throw new Error('WAZUH_INDEXER_URL is not set');

  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const body = {
    size: limit,
    sort: [{ '@timestamp': { order: 'desc' } }],
    query: {
      bool: {
        filter: [
          { range: { '@timestamp': { gte: `now-${minutes}m` } } },
          { range: { 'rule.level':  { gte: minLevel } } },
        ]
      }
    }
  };

  let res;
  try {
    res = await fetch(`${url}/${index}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    const cause = netErr.cause || netErr;
    const code  = cause.code || '';
    const msg   = cause.message || netErr.message || 'unknown';
    throw new Error(`Wazuh fetch failed [${code}]: ${msg} (URL: ${url})`);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Wazuh Indexer ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.hits?.hits || []).map(normalizeAlert);
}

function makeMock() {
  const now = Date.now();
  const t = (secAgo) => new Date(now - secAgo * 1000).toISOString();
  // A staged attack on one user/host so correlation, promotion, and MITRE all
  // have something to show in mock mode. IDs are stable so re-fetch dedups.
  return [
    { id:'mock-001', timestamp:t(600),
      rule_id:'5712', rule_level:10, rule_desc:'SSHD brute force: multiple authentication failures',
      rule_groups:['authentication_failures','sshd'], decoder:'sshd', agent_id:'001',
      agent_name:'WS-IT-17', src_ip:'118.25.6.39', username:'omar.kassis',
      hostname:'WS-IT-17.bank.local', mitre_techniques:['T1110'], mitre_tactics:['credential_access'], raw:{} },
    { id:'mock-002', timestamp:t(540),
      rule_id:'5715', rule_level:8, rule_desc:'SSHD authentication success after repeated failures',
      rule_groups:['authentication_success','sshd'], decoder:'sshd', agent_id:'001',
      agent_name:'WS-IT-17', src_ip:'118.25.6.39', username:'omar.kassis',
      hostname:'WS-IT-17.bank.local', mitre_techniques:['T1078'], mitre_tactics:['initial_access'], raw:{} },
    { id:'mock-003', timestamp:t(420),
      rule_id:'92052', rule_level:12, rule_desc:'Possible credential dumping (LSASS access) detected',
      rule_groups:['sysmon','credential_access'], decoder:'windows', agent_id:'001',
      agent_name:'WS-IT-17', src_ip:'118.25.6.39', username:'omar.kassis',
      hostname:'WS-IT-17.bank.local', process:'mimikatz.exe',
      mitre_techniques:['T1003'], mitre_tactics:['credential_access'], raw:{} },
    { id:'mock-004', timestamp:t(120),
      rule_id:'80710', rule_level:7, rule_desc:'Antivirus scan completed: no threats found',
      rule_groups:['antivirus'], decoder:'windows', agent_id:'002',
      agent_name:'WS-FIN-03', hostname:'WS-FIN-03.bank.local',
      mitre_techniques:[], mitre_tactics:[], raw:{} },
  ];
}

async function fetchAlerts(opts = {}) {
  if (process.env.WAZUH_MODE === 'mock') return makeMock();
  return fetchFromWazuh(opts);
}

module.exports = { fetchAlerts, normalizeAlert };
