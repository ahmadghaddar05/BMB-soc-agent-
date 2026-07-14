'use strict';

const {
  searchAlerts,
} = require('../services/elastic');

async function main() {
  const result = await searchAlerts({
    minutes: 1,
    minRiskScore: 48,
    limit: 5,
    statuses: ['open', 'acknowledged'],
    severities: ['high', 'critical'],
  });

  console.log(
    `Matching Elastic alerts: ${result.total}`
  );

  console.log(
    `Alerts returned: ${result.alerts.length}`
  );

  console.log(
    `Elastic query duration: ${result.took} ms`
  );

  console.log('');

  result.alerts.forEach((alert, index) => {
    console.log(`Alert ${index + 1}`);
    console.log(`  ID: ${alert.id}`);
    console.log(`  Time: ${alert.timestamp}`);
    console.log(`  Rule: ${alert.rule_desc}`);
    console.log(
      `  Severity: ${alert.source_severity}`
    );
    console.log(
      `  Risk score: ${alert.risk_score}`
    );
    console.log(
      `  Dataset: ${alert.event_dataset}`
    );
    console.log(`  User: ${alert.username}`);
    console.log(`  Host: ${alert.hostname}`);
    console.log(`  Source IP: ${alert.src_ip}`);
    console.log(
      `  Destination IP: ${alert.dst_ip}`
    );
    console.log(
      `  Workflow: ${alert.workflow_status}`
    );
    console.log('');
  });
}

main().catch(error => {
  console.error(
    'Elastic connector test failed:',
    error.message
  );

  process.exit(1);
});
