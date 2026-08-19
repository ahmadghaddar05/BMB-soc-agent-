'use strict';

const db = require('../db');
const elastic = require('../services/elastic');
const splunk = require('../services/splunk');

const CONFIRMATION = 'BACKFILL MITRE MAPPINGS';
const BATCH_SIZE = 1000;

function configuredSinceHours() {
  const value = process.env.MITRE_BACKFILL_SINCE_HOURS;
  if (value == null || String(value).trim() === '') return null;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 87600) {
    throw new Error('MITRE_BACKFILL_SINCE_HOURS must be an integer between 1 and 87600');
  }
  return hours;
}

function normalizeStoredAlert(row) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  if (row.source_system === 'elastic') {
    return elastic.normalizeAlert({
      _index:row.source_index || raw.elastic_index || '.alerts-security.alerts-default',
      _id:raw.elastic_document_id || String(row.id).replace(/^elastic:/, ''),
      fields:raw.fields && typeof raw.fields === 'object' ? raw.fields : raw,
    });
  }
  if (row.source_system === 'splunk') return splunk.normalizeAlert(raw);
  return null;
}

function missingMappings(row, normalized) {
  if (!normalized) return null;
  const techniques = Array.isArray(row.mitre_techniques) && row.mitre_techniques.length
    ? row.mitre_techniques : normalized.mitre_techniques || [];
  const tactics = Array.isArray(row.mitre_tactics) && row.mitre_tactics.length
    ? row.mitre_tactics : normalized.mitre_tactics || [];
  if (!techniques.length && !tactics.length) return null;
  const changed = techniques.length !== (row.mitre_techniques || []).length ||
    tactics.length !== (row.mitre_tactics || []).length;
  return changed ? { techniques, tactics } : null;
}

async function scan(mode) {
  const sinceHours = configuredSinceHours();
  let cursor = '';
  let scanned = 0;
  let candidates = 0;
  let updated = 0;
  const sample = [];
  while (true) {
    const { rows } = await db.query(
      `SELECT id,source_system,source_index,mitre_techniques,mitre_tactics,raw
       FROM alerts
       WHERE source_system IN ('elastic','splunk') AND id>$1
         AND ($3::int IS NULL OR timestamp >= NOW() - ($3::int * INTERVAL '1 hour'))
         AND (
           cardinality(COALESCE(mitre_techniques,'{}'::text[]))=0
           OR cardinality(COALESCE(mitre_tactics,'{}'::text[]))=0
         )
       ORDER BY id ASC LIMIT $2`,
      [cursor, BATCH_SIZE, sinceHours]
    );
    if (!rows.length) break;
    scanned += rows.length;
    for (const row of rows) {
      const mapping = missingMappings(row, normalizeStoredAlert(row));
      if (!mapping) continue;
      candidates += 1;
      if (sample.length < 10) sample.push({
        id:row.id,
        source:row.source_system,
        techniques:mapping.techniques,
        tactics:mapping.tactics,
      });
      if (mode === 'run') {
        await db.query(
          `UPDATE alerts SET mitre_techniques=$2,mitre_tactics=$3
           WHERE id=$1`,
          [row.id, mapping.techniques, mapping.tactics]
        );
        updated += 1;
      }
    }
    cursor = String(rows.at(-1).id);
  }
  return { mode, sinceHours, scanned, candidates, updated, sample };
}

async function main() {
  const mode = process.argv[2] || 'preview';
  if (!['preview', 'run'].includes(mode)) {
    throw new Error('Usage: node src/scripts/backfill-mitre-mappings.js <preview|run>');
  }
  if (mode === 'run' && process.env.MITRE_BACKFILL_CONFIRMATION !== CONFIRMATION) {
    throw new Error(`Set MITRE_BACKFILL_CONFIRMATION="${CONFIRMATION}" to run the backfill`);
  }
  process.stdout.write(`${JSON.stringify(await scan(mode), null, 2)}\n`);
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error(error.message || error);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}

module.exports = { configuredSinceHours, missingMappings, normalizeStoredAlert, scan };
