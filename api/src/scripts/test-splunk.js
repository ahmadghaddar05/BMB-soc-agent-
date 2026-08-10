'use strict';

const { checkHealth, fetchAlerts, validateConfiguration } = require('../services/splunk');

async function main() {
  const config = validateConfiguration();
  const health = await checkHealth();
  const alerts = await fetchAlerts({ minutes:15, limit:5 });
  console.log(JSON.stringify({
    ok:true,
    endpoint:new URL(config.url).host,
    index:config.index,
    search:config.search,
    authentication_scheme:config.authScheme,
    tls_verified:config.verifyTls,
    ca_certificate_configured:Boolean(config.caCert),
    health,
    sample_count:alerts.length,
    samples:alerts.map(alert => ({
      id:alert.id,
      timestamp:alert.timestamp,
      severity:alert.source_severity,
      rule_level:alert.rule_level,
      description:alert.rule_desc,
      source_index:alert.source_index,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ ok:false, error:error.message || String(error) }, null, 2));
  process.exitCode = 1;
});
