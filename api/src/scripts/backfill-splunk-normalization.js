'use strict';

const db = require('../db');
const { normalizeAlert } = require('../services/splunk');

const CONFIRMATION = 'BACKFILL SPLUNK ALERTS';

function changed(row, alert) {
  return row.rule_desc !== alert.rule_desc ||
    row.rule_id !== alert.rule_id ||
    row.rule_level !== alert.rule_level ||
    row.username !== alert.username ||
    row.event_dataset !== alert.event_dataset ||
    row.event_action !== alert.event_action ||
    row.alert_reason !== alert.alert_reason;
}

async function loadCandidates() {
  const { rows } = await db.query(
    `SELECT id,rule_id,rule_level,rule_desc,username,event_dataset,
            event_action,alert_reason,raw
       FROM alerts
      WHERE source_system='splunk'
      ORDER BY timestamp DESC`
  );
  return rows.map(row => ({ row, alert:normalizeAlert(row.raw || {}) }))
    .filter(item => changed(item.row, item.alert));
}

async function updateAlert(id, alert) {
  await db.query(
    `UPDATE alerts SET
       rule_id=$2,rule_level=$3,rule_desc=$4,rule_groups=$5,full_log=$6,
       src_ip=COALESCE($7,src_ip),dst_ip=COALESCE($8,dst_ip),
       username=COALESCE($9,username),hostname=COALESCE($10,hostname),
       target_db=COALESCE($11,target_db),process=COALESCE($12,process),
       mitre_techniques=$13,mitre_tactics=$14,raw=$15,
       risk_score=COALESCE($16,risk_score),source_severity=$17,
       alert_reason=$18,event_dataset=$19,event_category=$20,event_action=$21
     WHERE id=$1 AND source_system='splunk'`,
    [
      id, alert.rule_id, alert.rule_level, alert.rule_desc, alert.rule_groups,
      alert.full_log, alert.src_ip, alert.dst_ip, alert.username, alert.hostname,
      alert.target_db, alert.process, alert.mitre_techniques, alert.mitre_tactics,
      JSON.stringify(alert.raw || {}), alert.risk_score, alert.source_severity,
      alert.alert_reason, alert.event_dataset, alert.event_category,
      alert.event_action,
    ]
  );
}

async function main() {
  const mode = process.argv[2] || 'preview';
  if (!['preview', 'run'].includes(mode)) {
    throw new Error('Usage: node src/scripts/backfill-splunk-normalization.js <preview|run>');
  }
  const candidates = await loadCandidates();
  if (mode === 'run' && process.env.SPLUNK_NORMALIZATION_CONFIRMATION !== CONFIRMATION) {
    throw new Error(`Set SPLUNK_NORMALIZATION_CONFIRMATION="${CONFIRMATION}" to run the backfill`);
  }
  if (mode === 'run') {
    for (const { row, alert } of candidates) await updateAlert(row.id, alert);
  }
  process.stdout.write(`${JSON.stringify({
    mode,
    candidates:candidates.length,
    updated:mode === 'run' ? candidates.length : 0,
    sample:candidates.slice(0, 10).map(({ row, alert }) => ({
      id:row.id,
      before:row.rule_desc,
      after:alert.rule_desc,
      dataset:alert.event_dataset,
      action:alert.event_action,
    })),
  }, null, 2)}\n`);
}

main()
  .catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
