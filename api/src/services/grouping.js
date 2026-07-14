'use strict';

const crypto = require('crypto');

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map(normalizeValue)
      .filter(Boolean)
      .sort()
      .join(',');
  }

  return String(value)
    .trim()
    .toLowerCase();
}

function getTimeBucket(timestamp, windowMinutes = 5) {
  const date =
    timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  const time = date.getTime();

  if (!Number.isFinite(time)) {
    return '';
  }

  const safeWindow = Math.max(
    1,
    Number(windowMinutes) || 5
  );

  const windowMilliseconds =
    safeWindow * 60 * 1000;

  const bucket =
    Math.floor(time / windowMilliseconds) *
    windowMilliseconds;

  return new Date(bucket).toISOString();
}

function buildGroupKey(alert, windowMinutes = 5) {
  const identity = [
    alert.source_system || 'elastic',
    alert.rule_id || alert.rule_desc,
    alert.event_dataset || alert.decoder,
    alert.username,
    alert.hostname,
    alert.src_ip,
    alert.dst_ip,
    alert.process,
    getTimeBucket(
      alert.timestamp,
      windowMinutes
    ),
  ]
    .map(normalizeValue)
    .join('|');

  return crypto
    .createHash('sha256')
    .update(identity)
    .digest('hex');
}

module.exports = {
  buildGroupKey,
  getTimeBucket,
};
