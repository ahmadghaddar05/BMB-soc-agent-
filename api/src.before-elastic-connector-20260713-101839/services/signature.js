'use strict';
const crypto = require('crypto');

// A noise-reduction fingerprint: alerts with the same rule + same key entities
// are "the same kind of thing" and only need to be triaged once.
function alertSignature(a) {
  const parts = [
    a.rule_id   || '',
    a.src_ip    || '',
    a.dst_ip    || '',
    a.username  || '',
    a.hostname  || '',
    a.target_db || '',
  ].join('|');
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 16);
}

module.exports = { alertSignature };
