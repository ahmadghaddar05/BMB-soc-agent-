'use strict';
// Enrichment tools exposed to the agentic triage loop. The LLM chooses which
// to call and when, instead of receiving one pre-built enrichment blob.

function enrichmentUrl() {
  return (process.env.ENRICHMENT_URL || 'http://enrichment:3001').replace(/\/$/, '');
}

async function get(path) {
  const res = await fetch(`${enrichmentUrl()}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { error: `enrichment HTTP ${res.status}`, status: res.status };
  return res.json();
}
async function post(path, body) {
  const res = await fetch(`${enrichmentUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { error: `enrichment HTTP ${res.status}`, status: res.status };
  return res.json();
}

// OpenAI-style tool schemas (Groq-compatible).
const TRIAGE_TOOLS = [
  { type: 'function', function: {
      name: 'get_ad_user',
      description: 'Look up an Active Directory user by sAMAccountName. Returns privilege tier, criticality, MFA status, normal logon hours, home subnet, account enabled state.',
      parameters: { type:'object', properties:{ sam:{type:'string', description:'username / sAMAccountName'} }, required:['sam'] } } },
  { type: 'function', function: {
      name: 'check_logon',
      description: 'Check a logon for anomalies (outside normal hours, source outside home subnet, disabled account, MFA). Use when an alert involves a user authenticating from an IP.',
      parameters: { type:'object', properties:{
        sam:{type:'string'}, src_ip:{type:'string'}, timestamp:{type:'string', description:'ISO timestamp of the logon'} }, required:['sam'] } } },
  { type: 'function', function: {
      name: 'get_asset_by_host',
      description: 'CMDB lookup by hostname. Returns asset criticality, environment, owner, whether it is a crown-jewel system.',
      parameters: { type:'object', properties:{ hostname:{type:'string'} }, required:['hostname'] } } },
  { type: 'function', function: {
      name: 'get_asset_by_ip',
      description: 'CMDB lookup by IP address.',
      parameters: { type:'object', properties:{ ip:{type:'string'} }, required:['ip'] } } },
  { type: 'function', function: {
      name: 'get_edr_detections',
      description: 'Recent EDR detections on a host within the last N hours (default 48). Use to find corroborating endpoint activity.',
      parameters: { type:'object', properties:{ hostname:{type:'string'}, hours:{type:'integer'} }, required:['hostname'] } } },
  { type: 'function', function: {
      name: 'check_threat_intel',
      description: 'Threat-intel lookup for an indicator (IP, domain, hash). Returns whether it is known-malicious, category, and confidence.',
      parameters: { type:'object', properties:{ indicator:{type:'string'} }, required:['indicator'] } } },
  { type: 'function', function: {
      name: 'get_vuln_risk',
      description: 'Open vulnerability risk for a host: count, max CVSS, exploitable count, breakdown by severity.',
      parameters: { type:'object', properties:{ hostname:{type:'string'} }, required:['hostname'] } } },
];

async function dispatch(name, args = {}) {
  switch (name) {
    case 'get_ad_user':       return get(`/ad/users/${encodeURIComponent(args.sam)}`);
    case 'check_logon':       return post('/ad/logon-check', { sam: args.sam, src_ip: args.src_ip, timestamp: args.timestamp });
    case 'get_asset_by_host': return get(`/cmdb/by-hostname/${encodeURIComponent(args.hostname)}`);
    case 'get_asset_by_ip':   return get(`/cmdb/by-ip/${encodeURIComponent(args.ip)}`);
    case 'get_edr_detections':return get(`/edr/detections/${encodeURIComponent(args.hostname)}?hours=${parseInt(args.hours)||48}`);
    case 'check_threat_intel':return get(`/tip/${encodeURIComponent(args.indicator)}`);
    case 'get_vuln_risk':     return get(`/vuln/${encodeURIComponent(args.hostname)}/risk`);
    default: return { error: `unknown tool: ${name}` };
  }
}

module.exports = { TRIAGE_TOOLS, dispatch };
