'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:test@localhost/unused';
process.env.SOC_AUTH_DISABLED = 'true';

const db = require('../src/db');
const { createApp } = require('../src');

const originalQuery = db.query;
const originalSettings = db.getAllSettings;
const originalSetSetting = db.setSetting;
const originalSetSettingsAtomic = db.setSettingsAtomic;
const originalConnectorEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;

function routeApp() {
  process.env.SOC_AUTH_DISABLED = 'true';
  return createApp();
}

test.afterEach(() => {
  db.query = originalQuery;
  db.getAllSettings = originalSettings;
  db.setSetting = originalSetSetting;
  db.setSettingsAtomic = originalSetSettingsAtomic;
  if (originalConnectorEncryptionKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
  else process.env.CONNECTOR_ENCRYPTION_KEY = originalConnectorEncryptionKey;
});

function highestPlaceholder(sql) {
  return Math.max(0, ...[...String(sql).matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
}

test('administrator runtime summary exposes configuration state without credentials', async () => {
  db.getAllSettings = async () => ({ ai_model_profile:'gpt_5_6_sol' });
  const response = await request(routeApp()).get('/api/admin/runtime');
  assert.equal(response.status, 200);
  assert.equal(response.body.authentication.current_role, 'administrator');
  assert.equal(response.body.authentication.multi_user_directory_supported, false);
  assert.equal(response.body.ai_provider.provider, 'Hermes');
  assert.equal(Object.prototype.hasOwnProperty.call(response.body.ai_provider, 'api_key'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response.body.alert_source, 'elastic_api_key'), false);
});

test('administrator connector inventory exposes status but never encrypted credentials', async () => {
  const { encryptSecrets } = require('../src/services/connectors');
  process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  const encrypted = encryptSecrets({ token:'never-return-this', ca_certificate:null });
  db.query = async sql => {
    assert.match(String(sql), /FROM source_connectors/);
    return { rows:[{
      id:'00000000-0000-4000-8000-000000000001', name:'Client Splunk', connector_type:'splunk',
      config:{ protocol:'https', host:'splunk.client.internal', port:8089, verify_tls:true,
        index:'security', search:'search index=security', auth_scheme:'Bearer' },
      collection_state:{}, enabled:true, active:false, last_test_status:'success',
      last_tested_at:new Date().toISOString(), ...encrypted,
    }] };
  };

  const response = await request(routeApp()).get('/api/admin/connectors');
  assert.equal(response.status, 200);
  assert.equal(response.body.connectors[0].endpoint, 'https://splunk.client.internal:8089');
  assert.equal(response.body.connectors[0].credential_configured, true);
  const body = JSON.stringify(response.body);
  assert.equal(body.includes('never-return-this'), false);
  assert.equal(body.includes(encrypted.secret_ciphertext), false);
  assert.equal(Object.hasOwn(response.body.connectors[0], 'secret_ciphertext'), false);
});

test('administrator can inspect and activate an allowlisted AI model profile without exposing secrets', async () => {
  let active = 'gpt_5_6_sol';
  let written = null;
  db.getAllSettings = async () => ({ ai_model_profile:active });
  db.setSettingsAtomic = async entries => {
    written = entries;
    active = entries[0][1];
  };

  const listed = await request(routeApp()).get('/api/admin/ai-models');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.active_profile_id, 'gpt_5_6_sol');
  assert.equal(listed.body.profiles.length, 2);
  assert.equal(JSON.stringify(listed.body).includes('OPENROUTER_API_KEY='), false);
  assert.equal(Object.hasOwn(listed.body.profiles[1], 'api_key'), false);

  const activated = await request(routeApp())
    .put('/api/admin/ai-model')
    .send({ profile_id:'llama_3_3_70b' });
  assert.equal(activated.status, 200);
  assert.deepEqual(written, [['ai_model_profile', 'llama_3_3_70b']]);
  assert.equal(activated.body.active_profile_id, 'llama_3_3_70b');

  const rejected = await request(routeApp())
    .put('/api/admin/ai-model')
    .send({ profile_id:'arbitrary-provider-model' });
  assert.equal(rejected.status, 400);
});

test('administrator audit feed is bounded and applies supported filters', async () => {
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length);
    if (String(sql).includes('COUNT(*)::int AS n')) return { rows:[{ n:1 }] };
    assert.match(String(sql), /actor ILIKE/);
    assert.match(String(sql), /outcome=\$2/);
    return { rows:[{ id:1, actor:'analyst', event_type:'case.updated', outcome:'success', metadata:{} }] };
  };
  const response = await request(routeApp()).get('/api/admin/audit-events?actor=analyst&outcome=success&limit=20');
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.audit_events[0].event_type, 'case.updated');

  const invalid = await request(routeApp()).get('/api/admin/audit-events?outcome=unknown');
  assert.equal(invalid.status, 400);
});

test('data governance reports stored coverage and explicitly absent retention policies', async () => {
  db.getAllSettings = async () => ({ triage_cache_ttl_hours:'72' });
  db.query = async sql => {
    if (String(sql).includes('FROM alerts')) return { rows:[{ total:10, oldest:'2026-07-01', newest:'2026-07-20' }] };
    if (String(sql).includes('FROM audit_events')) return { rows:[{ total:4, oldest:'2026-07-10', newest:'2026-07-20' }] };
    if (String(sql).includes('FROM fetch_runs')) return { rows:[{ total:3, oldest:'2026-07-12', newest:'2026-07-20' }] };
    return { rows:[{ total:2, next_expiry:'2026-07-21', last_expiry:'2026-07-22' }] };
  };
  const response = await request(routeApp()).get('/api/admin/data-governance');
  assert.equal(response.status, 200);
  assert.equal(response.body.stores.alerts.total, 10);
  assert.equal(response.body.policies.triage_cache_ttl_hours, 72);
  assert.equal(response.body.policies.postgres_automatic_retention_configured, false);
  assert.equal(response.body.policies.elastic_source_lifecycle, 'managed_outside_bmb');
});

test('individual alert search supplies every SQL placeholder', async () => {
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length, `${highestPlaceholder(sql)} placeholders but ${params.length} parameters`);
    return String(sql).includes('COUNT(*) AS n') ? { rows:[{ n:'0' }] } : { rows:[] };
  };
  const response = await request(routeApp()).get('/api/alerts?search=needle&page=1&limit=20');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.alerts, []);
});

test('individual alerts filter on source severity and expose descriptive Elastic fields', async () => {
  let selectSql = '';
  const alert = {
    id:'elastic:1', source_severity:'critical', risk_score:94,
    alert_reason:'Credential dumping behavior detected',
    event_action:'credential-dump', event_category:['process'], event_dataset:'edr.endpoint',
  };
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length);
    if (String(sql).includes('COUNT(*) AS n')) return { rows:[{ n:'1' }] };
    selectSql = String(sql);
    return { rows:[alert] };
  };

  const response = await request(routeApp()).get('/api/alerts?severity=critical&page=1&limit=20');
  assert.equal(response.status, 200);
  assert.match(selectSql, /COALESCE\(source_severity, verdict->>'severity'\)=\$1/);
  for (const field of ['source_severity','alert_reason','event_action','event_category','event_dataset']) {
    assert.match(selectSql, new RegExp(`\\b${field}\\b`));
    assert.deepEqual(response.body.alerts[0][field], alert[field]);
  }
});

test('alert journey exposes recorded provenance without inferring missing stages', async () => {
  db.query = async (sql, params = []) => {
    assert.deepEqual(params, ['elastic:journey-1']);
    const text = String(sql);
    if (text.includes('FROM workflow_stage_events')) {
      return {
        rows:[{
          id:1, stage:'collected', status:'completed', executor_type:'system',
          reason:'Alert was collected from Elastic.',
        }],
      };
    }
    if (text.includes('FROM analyst_decision_reviews')) return { rows:[] };
    if (text.includes('FROM incidents')) {
      return {
        rows:[{
          id:17, title:'Stored incident membership', severity:'critical',
          status:'open', correlation_run_id:null,
        }],
      };
    }
    if (text.includes('FROM alerts WHERE id=$1')) {
      return {
        rows:[{
          id:'elastic:journey-1', source_system:'elastic',
          enrichment_status:'pending', triage_status:'pending',
        }],
      };
    }
    throw new Error(`Unexpected journey query: ${text.slice(0, 80)}`);
  };

  const response = await request(routeApp()).get('/api/alerts/elastic%3Ajourney-1/journey');
  assert.equal(response.status, 200);
  assert.equal(response.body.entity.type, 'alert');
  assert.equal(response.body.stages[0].stage, 'collected');
  assert.equal(response.body.current_state.incident.id, 17);
  assert.match(response.body.current_state.description, /currently stored as incident evidence/);
  assert.equal(response.body.provenance.append_only, true);
  assert.match(response.body.provenance.description, /Missing stages are not inferred/);
});

test('incident journey exposes bounded incident and per-alert correlation decisions', async () => {
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes("entity_type='alert'")) {
      assert.deepEqual(params, [['A','B']]);
      return {
        rows:[
          {
            alert_id:'A', id:10, stage:'correlated', status:'completed',
            executor_type:'ai', model:'meta-llama/llama-3.3-70b-instruct',
            confidence:0.84, reason:'Shared identity and host were validated.',
          },
          {
            alert_id:'A', id:11, stage:'incident_decision', status:'completed',
            executor_type:'ai', output_summary:{ decision:'created', incident_id:17 },
          },
        ],
      };
    }
    assert.deepEqual(params, ['17']);
    if (text.includes('FROM workflow_stage_events') && text.includes("entity_type='incident'")) {
      return {
        rows:[{
          id:9, stage:'incident_decision', status:'completed',
          executor_type:'ai', confidence_kind:'incident', confidence:0.84,
          output_summary:{ persistence_status:'created' },
        }],
      };
    }
    if (text.includes('FROM analyst_decision_reviews')) {
      return {
        rows:[{
          id:4, decision:'confirmed', reason:'The correlated evidence is sufficient.',
          actor:'analyst', created_at:'2026-07-29T08:00:00Z',
        }],
      };
    }
    if (text.includes('FROM incidents WHERE id=$1')) {
      return {
        rows:[{
          id:17, title:'Correlated identity activity', alert_ids:['A','B'],
          status:'open', severity:'critical',
        }],
      };
    }
    throw new Error(`Unexpected incident journey query: ${text.slice(0, 80)}`);
  };

  const response = await request(routeApp()).get('/api/incidents/17/journey');
  assert.equal(response.status, 200);
  assert.equal(response.body.entity.type, 'incident');
  assert.equal(response.body.entity.alert_count, 2);
  assert.equal(response.body.stages[0].confidence_kind, 'incident');
  assert.equal(response.body.correlation.alert_outcomes.length, 2);
  assert.equal(response.body.correlation.coverage.correlation_recorded, 1);
  assert.equal(response.body.correlation.coverage.incident_decision_recorded, 1);
  assert.equal(response.body.analyst_reviews[0].decision, 'confirmed');
  assert.match(response.body.provenance.description, /Missing decisions are not inferred/);
  assert.equal(Object.hasOwn(response.body, 'alerts'), false);
});

test('analyst decision reviews are validated, durable, and audited atomically', async () => {
  const calls = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes('SELECT 1 FROM alerts')) return { rows:[{ '?column?':1 }] };
    if (text.includes('INSERT INTO analyst_decision_reviews')) {
      return {
        rows:[{
          id:12, entity_type:'alert', entity_id:'A', decision:'challenged',
          reason:'The command-line evidence is missing.', actor:'admin',
        }],
      };
    }
    throw new Error(`Unexpected analyst review query: ${text.slice(0, 80)}`);
  };

  const response = await request(routeApp())
    .post('/api/workflow-reviews')
    .send({
      entity_type:'alert',
      entity_id:'A',
      decision:'challenged',
      reason:'The command-line evidence is missing.',
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.review.decision, 'challenged');
  const write = calls.find(call => call.text.includes('INSERT INTO analyst_decision_reviews'));
  assert.ok(write);
  assert.match(write.text, /INSERT INTO audit_events/);
  assert.equal(write.params[4], 'development');
});

test('analyst decision reviews reject unsupported or unexplained decisions', async () => {
  const unsupported = await request(routeApp())
    .post('/api/workflow-reviews')
    .send({ entity_type:'alert', entity_id:'A', decision:'approve', reason:'Enough explanation here.' });
  assert.equal(unsupported.status, 400);

  const unexplained = await request(routeApp())
    .post('/api/workflow-reviews')
    .send({ entity_type:'incident', entity_id:'7', decision:'confirmed', reason:'yes' });
  assert.equal(unexplained.status, 400);
});

test('workflow quality reports review coverage and agreement without claiming accuracy', async () => {
  db.query = async (sql, params = []) => {
    const text = String(sql);
    assert.equal(params.length, 1);
    assert.match(params[0], /^\d{4}-\d{2}-\d{2}T/);
    if (text.includes('WITH machine_scope AS')) {
      return { rows:[{
        alert_decisions:10, alert_reviewed:4, alert_confirmed:3,
        alert_challenged:1, alert_needs_evidence:0,
        incident_decisions:2, incident_reviewed:1, incident_confirmed:0,
        incident_challenged:0, incident_needs_evidence:1,
      }] };
    }
    if (text.includes('GROUP BY created_at::date')) {
      return { rows:[{
        day:'2026-07-29', reviews:5, confirmed:3, challenged:1, needs_evidence:1,
      }] };
    }
    if (text.includes('FROM analyst_decision_reviews reviews')) {
      return { rows:[{
        id:8, entity_type:'alert', entity_id:'A', decision:'challenged',
        reason:'The process evidence is incomplete.', actor:'analyst',
        title:'Suspicious process execution', severity:'critical',
        created_at:'2026-07-29T08:00:00Z',
      }] };
    }
    throw new Error(`Unexpected workflow quality query: ${text.slice(0, 80)}`);
  };

  const response = await request(routeApp()).get('/api/workflow-quality?days=30');
  assert.equal(response.status, 200);
  assert.equal(response.body.summary.machine_decisions, 12);
  assert.equal(response.body.summary.reviewed, 5);
  assert.equal(response.body.summary.review_coverage_percent, 41.7);
  assert.equal(response.body.summary.analyst_agreement_percent, 60);
  assert.equal(response.body.summary.challenged, 1);
  assert.equal(response.body.summary.needs_more_evidence, 1);
  assert.equal(response.body.methodology.accuracy_claim, false);
  assert.match(response.body.methodology.description, /not independently verified ground truth/);
  assert.equal(response.body.recent_reviews[0].decision, 'challenged');

  const invalid = await request(routeApp()).get('/api/workflow-quality?days=14');
  assert.equal(invalid.status, 400);
});

test('grouped alerts expose specific titles and search technical and asset identifiers', async () => {
  let groupsSql = '';
  const group = {
    representative_alert_id:'elastic:1', group_key:'group-1', source_severity:'critical',
    alert_reason:'Credential dumping behavior detected', event_action:'credential-dump',
    event_category:['process'], event_dataset:'edr.endpoint', occurrence_count:2,
  };
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length);
    if (String(sql).includes('COUNT(DISTINCT group_key)')) return { rows:[{ n:1 }] };
    groupsSql = String(sql);
    return { rows:[group] };
  };

  const response = await request(routeApp()).get('/api/alert-groups?page=1&limit=20&search=DB01');
  assert.equal(response.status, 200);
  for (const field of ['alert_reason','event_action','event_category','event_dataset']) {
    assert.ok((groupsSql.match(new RegExp(`\\b${field}\\b`, 'g')) || []).length >= 3);
    assert.deepEqual(response.body.groups[0][field], group[field]);
  }
  for (const field of ['id','group_key','agent_name','hostname','target_db','username']) {
    assert.match(groupsSql, new RegExp(`COALESCE\\(${field}|\\b${field} ILIKE`));
  }
  assert.doesNotMatch(groupsSql, /source_system\s*=\s*'elastic'/);
});

test('identity pivots search alert evidence and incidents linked through matching alerts', async () => {
  let alertSql = '';
  let incidentSql = '';
  const alert = {
    id:'elastic:identity-1', timestamp:'2026-07-20T08:00:00.000Z',
    username:'maya.georges', hostname:'HR-WS001', event_action:'successful-login',
  };
  const incident = {
    id:17, title:'Coordinated identity activity', severity:'high', status:'open',
  };
  db.query = async (sql, params = []) => {
    const text = String(sql);
    assert.ok(highestPlaceholder(text) <= params.length);
    assert.deepEqual(params, ['%maya.georges%']);
    if (text.includes('SELECT id, timestamp')) {
      alertSql = text;
      return { rows:[alert] };
    }
    incidentSql = text;
    return { rows:[incident] };
  };

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok:false });
  try {
    const response = await request(routeApp()).get('/api/pivot?indicator=maya.georges');
    assert.equal(response.status, 200);
    assert.equal(response.body.alert_count, 1);
    assert.equal(response.body.incident_count, 1);
    assert.deepEqual(response.body.alerts, [alert]);
    assert.deepEqual(response.body.incidents, [incident]);
  } finally {
    global.fetch = originalFetch;
  }

  for (const field of ['src_ip','dst_ip','username','hostname','agent_name','process','event_dataset','event_action','alert_reason','enrichment']) {
    assert.match(alertSql, new RegExp(`\\b${field}\\b`));
  }
  for (const field of ['target_db','mitre_techniques','mitre_tactics','group_key','occurrence_count']) {
    assert.match(alertSql, new RegExp(`\\b${field}\\b`));
  }
  assert.match(incidentSql, /EXISTS\s*\(/);
  assert.match(incidentSql, /\balert_ids\b/);
  assert.match(incidentSql, /\bcommon_entities\b/);
  assert.match(incidentSql, /a\.username/);
  assert.match(incidentSql, /a\.hostname/);
  assert.match(incidentSql, /a\.target_db/);
});

test('SOC analytics returns bounded evidence-backed security aggregations', async () => {
  const observed = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    observed.push({ text, params });
    assert.ok(highestPlaceholder(text) <= params.length);
    if (text.includes('analytics_summary')) return { rows:[{
      total_alerts:120, critical:12, high:28, triaged:90,
      unique_source_ips:14, unique_targets:9, correlation_decisions:44,
    }] };
    if (text.includes('analytics_trend')) return { rows:[{
      bucket:'2026-07-29T08:00:00.000Z', total:20, critical:2, high:5, other:13, unique_sources:4,
    }] };
    if (text.includes('analytics_severity')) return { rows:[{ name:'critical', count:12 }] };
    if (text.includes('analytics_sources')) return { rows:[{ name:'198.51.100.24', count:18, high_risk:7 }] };
    if (text.includes('analytics_destinations')) return { rows:[{ name:'WEBAPP01', count:22, high_risk:9 }] };
    if (text.includes('analytics_datasets')) return { rows:[{ name:'web.application', count:30 }] };
    if (text.includes('analytics_identities')) return { rows:[{ name:'maya.georges', count:16, high_risk:8 }] };
    if (text.includes('analytics_tactics')) return { rows:[{ name:'initial_access', count:11 }] };
    if (text.includes('analytics_detections')) return { rows:[{ name:'Suspicious PowerShell execution', count:14 }] };
    throw new Error('Unexpected analytics query');
  };

  const response = await request(routeApp()).get('/api/analytics/security?hours=24');
  assert.equal(response.status, 200);
  assert.equal(response.body.source, 'stored_bmb_alerts');
  assert.equal(response.body.summary.total_alerts, 120);
  assert.equal(response.body.top_source_ips[0].name, '198.51.100.24');
  assert.equal(response.body.top_destinations[0].name, 'WEBAPP01');
  assert.equal(response.body.mitre_tactics[0].name, 'initial_access');
  assert.equal(response.body.trend[0].unique_sources, 4);
  assert.equal(observed.length, 9);
  assert.ok(observed.every(item => item.params[0] === 24));

  db.query = async () => { throw new Error('invalid windows must not query the database'); };
  const invalid = await request(routeApp()).get('/api/analytics/security?hours=48');
  assert.equal(invalid.status, 400);
});

test('executive overview returns an auditable aggregate contract with no fabricated containment', async () => {
  const incident = {
    id:42, title:'Coordinated identity compromise', severity:'critical', confidence:0.91,
    attack_stages:['credential_access'], common_entities:{ users:['maya.georges'] },
    alert_ids:['elastic:1','elastic:2'], narrative:'Correlated evidence across two systems.',
    recommended_actions:['Validate identity activity'], first_seen:'2026-07-19T10:00:00.000Z',
    last_seen:'2026-07-19T10:10:00.000Z', status:'open', owner:null,
    business_impact:'high', alert_count:2,
  };
  const asset = {
    name:'Customer Database', type:'database', activity_count:8,
    high_risk_activity_count:3, business_impact:'high', last_seen:'2026-07-19T10:10:00.000Z',
  };
  db.query = async (sql, params = []) => {
    const text = String(sql);
    assert.ok(highestPlaceholder(text) <= params.length);
    if (text.includes('executive_activity_summary')) return { rows:[{
      total:100, critical:5, high:10, medium:20, low:65,
      triage_pending:20, triaged:75,
    }] };
    if (text.includes('executive_business_risk_summary')) {
      return { rows:[{
        total:5, critical:1, previous_critical:2,
        unassigned_high:1, high:2, medium:2, low:1,
      }] };
    }
    if (text.includes('executive_business_risk_items')) return { rows:[incident] };
    if (text.includes('executive_fetch_metrics')) return { rows:[{
      stored:100, triaged:75, incidents_created:2, investigations_created:3,
      investigation_notes_added:4, case_notes_added:5, approvals_requested:1,
      autonomous_failures:1,
    }] };
    if (text.includes('executive_risk_trend')) return { rows:[{
      day:'2026-07-19', activities:10, critical:1, high:2, medium:3, low:4,
      pending:2, incidents_created:1, critical_incidents:1, high_incidents:0,
      high_impact:1, medium_impact:0, low_impact:0,
      response_time_hours:'1.5', responded_incidents:1,
    }] };
    if (text.includes('executive_top_assets')) return { rows:[asset] };
    if (text.includes('executive_business_service_risk')) return { rows:[{
      current_services:2,
      previous_services:1,
      current_high_risk_incidents:2,
      mapped_high_risk_incidents:2,
      services:[
        { name:'Core Banking', criticality:'critical', incident_count:1, mapping_source:'bmb_cmdb_taxonomy' },
        { name:'Identity & Authentication', criticality:'critical', incident_count:1, mapping_source:'bmb_cmdb_taxonomy' },
      ],
    }] };
    if (text.includes('executive_response_metrics')) return { rows:[{
      current_hours:'1.5',
      previous_hours:'2.5',
      incidents_in_scope:4,
      incidents_with_response:3,
    }] };
    if (text.includes('executive_workflow_controls')) return { rows:[{
      pending_approvals:2, failed_actions:1, executed_internal_actions:3,
    }] };
    if (text.includes('executive_source_coverage')) return { rows:[{
      activities:100, asset_mapped:80, enriched:75,
    }] };
    throw new Error(`Unexpected query: ${text}`);
  };

  const response = await request(routeApp()).get('/api/executive/overview');
  assert.equal(response.status, 200);
  assert.equal(response.body.window_days, 30);
  assert.match(response.body.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.body.health.score, 81);
  assert.equal(response.body.health.status, 'guarded');
  assert.equal(response.body.health.methodology.derived, true);
  assert.deepEqual(response.body.business_risks.by_impact, { critical:1, high:2, medium:2, low:1 });
  assert.equal(response.body.business_risks.items[0].title, incident.title);
  assert.equal(response.body.business_risks.items[0].required_decision, 'Assign an accountable incident owner');
  for (const restricted of ['attack_stages','common_entities','alert_ids','narrative','recommended_actions']) {
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.business_risks.items[0], restricted), false);
  }
  assert.equal(response.body.automation.triage_rate, 75);
  assert.equal(response.body.automation.primary_metric, 'ai_triage_coverage');
  assert.equal(response.body.automation.end_to_end_completion_supported, false);
  assert.equal(response.body.automation.autonomous_completion_rate, null);
  assert.match(response.body.automation.scope_note, /does not automatically close/);
  assert.equal(response.body.time_saved.minutes, 730);
  assert.equal(response.body.time_saved.hours, 12.2);
  assert.match(response.body.time_saved.methodology, /token usage is not treated as human time/);
  assert.equal(response.body.risk_trend[0].date, '2026-07-19');
  assert.equal(response.body.risk_trend[0].telemetry_sufficient, true);
  assert.equal(response.body.risk_trend[0].critical_incidents_created, 1);
  assert.equal(response.body.risk_trend[0].response_time_hours, 1.5);
  assert.equal(response.body.risk_trend[0].responded_incidents, 1);
  assert.equal(typeof response.body.risk_trend[0].risk_score, 'number');
  assert.equal(response.body.top_assets[0].name, 'Customer Data Platform');
  assert.equal(response.body.top_assets[0].type, 'observed technology category');
  assert.equal(response.body.top_assets[0].business_service_mapped, false);
  assert.equal(Object.prototype.hasOwnProperty.call(response.body.top_assets[0], 'hostname'), false);
  assert.equal(response.body.executive_metrics.cyber_risk_exposure.value, 19);
  assert.equal(response.body.executive_metrics.critical_business_services_at_risk.available, true);
  assert.equal(response.body.executive_metrics.critical_business_services_at_risk.value, 2);
  assert.equal(response.body.executive_metrics.critical_business_services_at_risk.coverage_percent, 100);
  assert.equal(response.body.executive_metrics.open_critical_incidents.previous_period, 2);
  assert.equal(response.body.executive_metrics.mean_time_to_respond.available, true);
  assert.equal(response.body.executive_metrics.mean_time_to_respond.value, 1.5);
  assert.equal(response.body.executive_metrics.mean_time_to_respond.coverage_percent, 75);
  assert.equal(response.body.business_services_at_risk.services.length, 2);
  assert.equal(response.body.response_performance.incidents_with_response, 3);
  assert.equal(response.body.executive_metrics.estimated_analyst_time_saved.confidence, 'estimated');
  assert.equal(response.body.automation.pending_approvals, 2);
  assert.equal(response.body.automation.external_actions_supported, false);
  assert.equal(response.body.decision_queue.unassigned_high_impact_incidents, 1);
  assert.equal(response.body.source_coverage.asset_mapping_percent, 80);
});

test('executive incident endpoints return decision briefs without technical evidence', async () => {
  const incident = {
    id:42,
    title:'Coordinated identity compromise',
    severity:'critical',
    confidence:0.91,
    status:'open',
    owner:null,
    first_seen:'2026-07-19T10:00:00.000Z',
    last_seen:'2026-07-19T10:10:00.000Z',
    alert_count:14,
    alert_ids:['elastic:1'],
    narrative:'Raw technical narrative mentioning 192.168.10.26 and maya.georges.',
    common_entities:{ users:['maya.georges'], hosts:['IT-ADMIN01'] },
    recommended_actions:['Disable an account'],
  };
  db.query = async (sql, params = []) => {
    const text = String(sql);
    assert.ok(highestPlaceholder(text) <= params.length);
    if (text.includes('COUNT(*)::int AS n')) return { rows:[{ n:1 }] };
    if (text.includes('executive_risk_directory')) return { rows:[incident] };
    if (text.includes('executive_incident_brief')) {
      assert.deepEqual(params, ['42']);
      return { rows:[incident] };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const directory = await request(routeApp()).get('/api/executive/risks?page=1&limit=20');
  assert.equal(directory.status, 200);
  assert.equal(directory.body.risks[0].title, incident.title);

  const brief = await request(routeApp()).get('/api/executive/incidents/42');
  assert.equal(brief.status, 200);
  assert.equal(brief.body.detail_level, 'executive_summary');
  assert.equal(brief.body.technical_evidence_restricted, true);
  assert.match(brief.body.executive_summary, /No accountable owner/);
  assert.equal(brief.body.required_decision, 'Assign an accountable incident owner');
  for (const payload of [directory.body.risks[0], brief.body]) {
    for (const restricted of ['alerts','alert_ids','narrative','common_entities','recommended_actions','attack_stages']) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload, restricted), false);
    }
    assert.doesNotMatch(JSON.stringify(payload), /192\.168\.10\.26|maya\.georges|IT-ADMIN01/);
  }
});

test('durable automation operation details remain addressable by id', async () => {
  const operation = { id:42, operation_type:'add_case_note', source_type:'case', source_id:'7', status:'completed' };
  db.query = async (sql, params = []) => {
    assert.match(String(sql), /FROM autonomous_operations WHERE id=\$1/);
    assert.deepEqual(params, ['42']);
    return { rows:[operation] };
  };
  const response = await request(routeApp()).get('/api/agent/operations/42');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, operation);
});

test('executive overview only accepts documented windows and applies the selected window', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const invalid = await request(routeApp()).get('/api/executive/overview?days=14');
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error.message, /7, 30, or 90/);

  const parameterized = [];
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length);
    if (highestPlaceholder(sql)) parameterized.push(params);
    return { rows:[] };
  };
  const valid = await request(routeApp()).get('/api/executive/overview?days=7');
  assert.equal(valid.status, 200);
  assert.equal(valid.body.window_days, 7);
  assert.equal(parameterized.length, 9);
  assert.ok(parameterized.every(params => params.length === 1 && params[0] === 7));
});

test('invalid pagination is rejected before querying the database', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const response = await request(routeApp()).get('/api/alerts?page=0&limit=1000');
  assert.equal(response.status, 400);
});

test('grouped alert filters reject invalid pagination and enums', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const badLimit = await request(routeApp()).get('/api/alert-groups?limit=101');
  assert.equal(badLimit.status, 400);
  const badSeverity = await request(routeApp()).get('/api/alert-groups?severity=urgent');
  assert.equal(badSeverity.status, 400);
});

test('chat validates message and history before calling an AI provider', async () => {
  const invalidMessage = await request(routeApp()).post('/api/chat').send({ message:'' });
  assert.equal(invalidMessage.status, 400);
  const invalidHistory = await request(routeApp()).post('/api/chat').send({ message:'hello', history:'not-an-array' });
  assert.equal(invalidHistory.status, 400);
  const invalidStream = await request(routeApp()).post('/api/chat/stream').send({ message:'', history:[] });
  assert.equal(invalidStream.status, 400);
});

test('chat stream fails closed before opening when Hermes is not configured', async () => {
  const previous = process.env.HERMES_API_KEY;
  delete process.env.HERMES_API_KEY;
  try {
    const response = await request(routeApp()).post('/api/chat/stream').send({ message:'Find alert A' });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'HERMES_NOT_CONFIGURED');
  } finally {
    if (previous === undefined) delete process.env.HERMES_API_KEY;
    else process.env.HERMES_API_KEY = previous;
  }
});

test('chat fails closed when Hermes is not configured and never reads legacy settings', async () => {
  const previous = process.env.HERMES_API_KEY;
  delete process.env.HERMES_API_KEY;
  db.getAllSettings = async () => { throw new Error('legacy settings must not be read'); };
  try {
    const response = await request(routeApp()).post('/api/chat').send({ message:'What is critical?' });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'HERMES_NOT_CONFIGURED');
  } finally {
    if (previous === undefined) delete process.env.HERMES_API_KEY;
    else process.env.HERMES_API_KEY = previous;
  }
});

test('missing retriage alert returns 404 without selecting another alert', async () => {
  const queries = [];
  db.getAllSettings = async () => ({});
  db.query = async sql => { queries.push(String(sql)); return { rows:[], rowCount:0 }; };
  const response = await request(routeApp()).post('/api/alerts/missing/retriage').send({});
  assert.equal(response.status, 404);
  assert.equal(queries.filter(sql => sql.includes('SELECT * FROM alerts')).length, 0);
});

test('retriage selection is scoped to the requested alert ID', async () => {
  const queries = [];
  db.getAllSettings = async () => ({});
  db.query = async (sql, params) => {
    queries.push({ sql:String(sql), params });
    if (String(sql).includes('SELECT id,enrichment_status')) {
      return { rows:[{ id:'alert-a', enrichment_status:'enriched' }], rowCount:1 };
    }
    if (String(sql).includes('UPDATE alerts')) return { rows:[{ id:'alert-a' }], rowCount:1 };
    if (String(sql).includes('SELECT * FROM alerts')) return { rows:[] };
    return { rows:[] };
  };
  const response = await request(routeApp()).post('/api/alerts/alert-a/retriage').send({});
  assert.equal(response.status, 200);
  const selection = queries.find(query => query.sql.includes('SELECT * FROM alerts'));
  assert.match(selection.sql, /AND id=\$1/);
  assert.equal(selection.params[0], 'alert-a');
});

test('retriage rejects failed enrichment before starting Hermes', async () => {
  db.getAllSettings = async () => ({});
  db.query = async sql => String(sql).includes('SELECT id,enrichment_status')
    ? { rows:[{ id:'alert-a', enrichment_status:'enrichment_failed' }], rowCount:1 }
    : { rows:[], rowCount:0 };
  const response = await request(routeApp()).post('/api/alerts/alert-a/retriage').send({});
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'HERMES_ENRICHMENT_REQUIRED');
});

test('manual Hermes correlation endpoint is available and bounded by the worker', async () => {
  db.getAllSettings = async () => ({ correlation_enabled:'false' });
  db.query = async () => ({ rows:[], rowCount:0 });
  const response = await request(routeApp()).post('/api/scheduler/correlate-now').send({});
  assert.equal(response.status, 200);
  assert.equal(response.body.skipped_reason, 'no_new_triaged_alerts');
});

test('Phase 9 action policy exposes only approval-gated simulations and rejects real containment', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const policy = await request(routeApp()).get('/api/action-policy');
  assert.equal(policy.status, 200);
  assert.equal(policy.body.version, 'phase9-v1');
  assert.equal(policy.body.actions['case.update'].approvalRequired, true);
  assert.equal(policy.body.actions['case.add_note'].approvalRequired, false);
  assert.equal(policy.body.actions['response.simulate'].approvalRequired, true);
  assert.equal(policy.body.actions['response.rollback'].approvalRequired, true);
  assert.equal(policy.body.actions['host.isolate'], undefined);

  const denied = await request(routeApp()).post('/api/actions').send({
    action_type:'host.isolate', target_id:'server-1', parameters:{}, reason:'Contain endpoint',
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'ACTION_FORBIDDEN');
});

test('action list rejects unsupported status and oversized pages before querying', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const badStatus = await request(routeApp()).get('/api/actions?status=approved_and_executed');
  const badLimit = await request(routeApp()).get('/api/actions?limit=101');
  assert.equal(badStatus.status, 400);
  assert.equal(badLimit.status, 400);
});

test('simulated response list rejects invalid state, type, and pagination before querying', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const badState = await request(routeApp()).get('/api/responses?state=executed');
  const badType = await request(routeApp()).get('/api/responses?response_type=real_isolation');
  const badLimit = await request(routeApp()).get('/api/responses?limit=101');
  assert.equal(badState.status, 400);
  assert.equal(badType.status, 400);
  assert.equal(badLimit.status, 400);
});

test('settings permit Hermes correlation but still reject automatic closure and singleton promotion', async () => {
  const autoClose = await request(routeApp()).put('/api/settings').send({ autoclose_enabled:'true' });
  assert.equal(autoClose.status, 400);
  db.setSettingsAtomic = async () => {};
  db.getAllSettings = async () => ({ correlation_enabled:'true' });
  const correlation = await request(routeApp()).put('/api/settings').send({ correlation_enabled:'true' });
  assert.equal(correlation.status, 200);
  const promotion = await request(routeApp()).put('/api/settings').send({ incident_promote_enabled:'true' });
  assert.equal(promotion.status, 400);
});

test('settings updates delegate one atomic audited change set', async () => {
  let recorded = null;
  db.setSettingsAtomic = async (entries, context) => { recorded = { entries, context }; };
  db.getAllSettings = async () => ({ triage_enabled:'true', correlation_enabled:'true' });
  const response = await request(routeApp()).put('/api/settings').send({
    triage_enabled:'true', correlation_enabled:'true',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(recorded.entries, [['triage_enabled', 'true'], ['correlation_enabled', 'true']]);
  assert.equal(recorded.context.actor, 'development');
  assert.ok(recorded.context.requestId);
});

test('Elastic collector controls accept only bounded values consumed by the pipeline', async () => {
  let recorded = null;
  db.setSettingsAtomic = async entries => { recorded = entries; };
  db.getAllSettings = async () => ({});
  const accepted = await request(routeApp()).put('/api/settings').send({
    elastic_lookback_minutes:'1440', elastic_min_risk_score:'48', elastic_limit:'200',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(recorded, [
    ['elastic_lookback_minutes', '1440'], ['elastic_min_risk_score', '48'], ['elastic_limit', '200'],
  ]);
  const rejected = await request(routeApp()).put('/api/settings').send({ elastic_min_risk_score:'101' });
  assert.equal(rejected.status, 400);
});

test('live collection settings are independent from optional AI processing', async () => {
  let written = null;
  db.setSettingsAtomic = async entries => { written = entries; };
  db.getAllSettings = async () => Object.fromEntries(written || []);
  const accepted = await request(routeApp()).put('/api/settings').send({
    live_collection_enabled:'true',
    live_collection_interval_seconds:'15',
    scheduler_enabled:'false',
    triage_enabled:'false',
    correlation_enabled:'false',
    autonomous_agent_enabled:'false',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(Object.fromEntries(written), {
    live_collection_enabled:'true',
    live_collection_interval_seconds:'15',
    scheduler_enabled:'false',
    triage_enabled:'false',
    correlation_enabled:'false',
    autonomous_agent_enabled:'false',
  });

  const tooFast = await request(routeApp()).put('/api/settings').send({
    live_collection_interval_seconds:'4',
  });
  assert.equal(tooFast.status, 400);
});

test('Phase 9 autonomous and simulated-response policy settings remain explicitly opt-in', async () => {
  db.setSettingsAtomic = async () => {};
  db.getAllSettings = async () => ({ autonomous_agent_enabled:'true' });
  const enabled = await request(routeApp()).put('/api/settings').send({
    autonomous_agent_enabled:'true', autonomous_lookback_hours:'24',
    autonomous_max_items:'20', autonomous_min_confidence:'0.75',
    autonomous_assignment_enabled:'true', autonomous_default_owner:'Tier 2 SOC',
    simulated_response_proposals_enabled:'true',
  });
  assert.equal(enabled.status, 200);
  const badConfidence = await request(routeApp()).put('/api/settings').send({ autonomous_min_confidence:'1.1' });
  const badOwner = await request(routeApp()).put('/api/settings').send({ autonomous_default_owner:'' });
  assert.equal(badConfidence.status, 400);
  assert.equal(badOwner.status, 400);
});

test('missing incident update returns 404', async () => {
  db.query = async () => ({ rows:[], rowCount:0 });
  const response = await request(routeApp()).patch('/api/incidents/999').send({ status:'closed' });
  assert.equal(response.status, 404);
});

test('unknown settings are rejected instead of silently ignored', async () => {
  const response = await request(routeApp()).put('/api/settings').send({ made_up_setting:'true' });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /Unsupported settings/);
});
