'use strict';

const db = require('../db');

const {
  buildGroupKey,
} = require('../services/grouping');

async function main() {
  const settings =
    await db.getAllSettings();

  const windowMinutes = parseInt(
    settings.elastic_group_window_minutes ||
    '5',
    10
  );

  const result = await db.query(`
    SELECT
      id,
      timestamp,
      rule_id,
      rule_desc,
      decoder,
      event_dataset,
      username,
      hostname,
      src_ip::text AS src_ip,
      dst_ip::text AS dst_ip,
      process,
      event_action,
      source_system
    FROM alerts
    WHERE group_key IS NULL
       OR source_system = 'splunk'
    ORDER BY timestamp
  `);

  let updated = 0;

  for (const alert of result.rows) {
    const groupKey = buildGroupKey(
      alert,
      windowMinutes,
      {
        includeTimeBucket:!(
          alert.source_system === 'splunk' &&
          alert.event_action === 'alert_fired' &&
          alert.rule_id &&
          alert.rule_id !== 'splunk_event'
        ),
      }
    );

    await db.query(
      `UPDATE alerts
       SET group_key = $1
       WHERE id = $2`,
      [groupKey, alert.id]
    );

    updated++;
  }

  const summary = await db.query(`
    SELECT
      COUNT(*) AS individual_alerts,
      COUNT(DISTINCT group_key)
        AS unique_groups,
      COUNT(*) -
      COUNT(DISTINCT group_key)
        AS repeated_alerts
    FROM alerts
    WHERE group_key IS NOT NULL
  `);

  console.log(
    `Grouping window: ${windowMinutes} minutes`
  );

  console.log(
    `Alerts updated: ${updated}`
  );

  console.log(
    'Grouping summary:',
    summary.rows[0]
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      'Group-key backfill failed:',
      error.message
    );

    process.exit(1);
  });
