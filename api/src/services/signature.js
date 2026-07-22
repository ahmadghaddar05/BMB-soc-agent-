'use strict';
const crypto = require('crypto');

// A noise-reduction fingerprint: alerts with the same rule + same key entities
// are "the same kind of thing" and only need to be triaged once.
function alertSignature(a) {
  const risk = Number(a.risk_score);
  const riskBucket = Number.isFinite(risk) ? Math.floor(risk / 10) * 10 : '';

  // Include fields that materially change the security meaning of an alert.
  // This prevents an old cached verdict from being reused for a different
  // process/action or risk tier while still collapsing genuine alert storms.
  const parts = [
    a.rule_id         || '',
    a.src_ip          || '',
    a.dst_ip          || '',
    a.username        || '',
    a.hostname        || '',
    a.target_db       || '',
    a.process         || '',
    a.event_action    || '',
    a.source_severity || '',
    riskBucket,
  ].map(v => String(v).trim().toLowerCase()).join('|');
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 20);
}

module.exports = { alertSignature };
