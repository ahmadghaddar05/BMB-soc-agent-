import {
  AlertTriangle, ArrowRight, Database, GitMerge, Globe2, Network, ShieldAlert, UserRound,
} from 'lucide-react';
import { activityTitle, alertReference } from '../lib/executive';
import { relativeTime, severityOf } from '../lib/soc';
import { Card, EmptyState, SeverityBadge, StatusChip } from './ui';

const RELATION_FIELDS = [
  ['username', 'identity'], ['hostname', 'host'], ['agent_name', 'agent'],
  ['src_ip', 'source IP'], ['dst_ip', 'destination IP'], ['target_db', 'database'],
  ['process', 'process'], ['event_dataset', 'dataset'],
];

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function relationToIndicator(alert, indicator) {
  const target = normalized(indicator);
  const matches = RELATION_FIELDS
    .filter(([field]) => normalized(alert[field]).includes(target))
    .map(([field, label]) => ({ label, value:alert[field] }));
  if (matches.length) return matches;
  if (normalized(alert.id).includes(target)) return [{ label:'alert reference', value:alertReference(alert) }];
  return [{ label:'evidence match', value:'rule or enrichment content' }];
}

function sharedRelations(left, right) {
  if (!left || !right) return [];
  return RELATION_FIELDS.flatMap(([field, label]) => {
    const leftValue = normalized(left[field]);
    const rightValue = normalized(right[field]);
    return leftValue && leftValue === rightValue ? [{ label, value:left[field] }] : [];
  });
}

function incidentReference(id) {
  return `INC-${String(id).padStart(5, '0')}`;
}

export default function EntityRelationshipGraph({ indicator, observableType, alerts = [], incidents = [], navigate }) {
  const ObservableIcon = observableType?.kind === 'identity' ? UserRound : observableType?.kind === 'network' ? Globe2 : Database;
  const orderedAlerts = [...alerts].sort((left, right) => new Date(left.timestamp || 0) - new Date(right.timestamp || 0)).slice(-10);
  const incidentByAlert = new Map();
  for (const incident of incidents) {
    for (const alertId of incident.alert_ids || []) {
      const key = String(alertId);
      if (!incidentByAlert.has(key)) incidentByAlert.set(key, []);
      incidentByAlert.get(key).push(incident);
    }
  }
  const entityValues = new Set(orderedAlerts.flatMap(alert => RELATION_FIELDS.map(([field]) => alert[field]).filter(Boolean)));

  return (
    <Card
      className="entity-relationship-panel-v2"
      title="Evidence relationship map"
      caption="Observed paths from this pivot to matching alerts and stored incident membership"
      action={<StatusChip status={orderedAlerts.length ? 'active' : 'neutral'}>{orderedAlerts.length} alerts mapped</StatusChip>}
    >
      <dl className="entity-graph-facts-v2"><div><dt>Alert evidence</dt><dd>{orderedAlerts.length}</dd></div><div><dt>Related values</dt><dd>{entityValues.size}</dd></div><div><dt>Stored incidents</dt><dd>{incidents.length}</dd></div></dl>

      <div className="entity-map-v2">
        <aside className="entity-map-anchor-v2"><span>Investigated observable</span><div><ObservableIcon aria-hidden="true" /><small>{observableType?.label || 'Security observable'}</small><strong>{indicator}</strong></div><p>Links below represent stored equality or incident membership, not inferred relationships.</p></aside>

        <section className="entity-alert-lane-v2" aria-label="Related alert evidence">
          <header><div><h3>Alert evidence</h3><p>Oldest to newest · latest 10 matches</p></div></header>
          {orderedAlerts.length ? <ol>{orderedAlerts.map((alert, index) => {
            const direct = relationToIndicator(alert, indicator);
            const shared = sharedRelations(orderedAlerts[index - 1], alert);
            const linkedIncidents = incidentByAlert.get(String(alert.id)) || [];
            return <li key={alert.id}>
              {index > 0 && <div className="entity-peer-link-v2"><span>{shared.length ? shared.slice(0, 2).map(item => `${item.label}: ${item.value}`).join(' · ') : 'same observable pivot'}</span></div>}
              <button type="button" onClick={() => navigate(`/alerts?search=${encodeURIComponent(alert.id)}`)}><span><code>{alertReference(alert)}</code><strong>{activityTitle(alert)}</strong><small>{relativeTime(alert.timestamp)} · {alert.event_dataset || alert.agent_name || 'Stored alert'}</small></span><SeverityBadge severity={severityOf(alert)} /><ArrowRight aria-hidden="true" /></button>
              <div className="entity-match-chips-v2">{direct.slice(0, 3).map(item => <span key={`${item.label}-${item.value}`}><b>{item.label}:</b> {item.value}</span>)}{linkedIncidents.map(incident => <span className="is-incident" key={incident.id}><b>incident:</b> {incidentReference(incident.id)}</span>)}</div>
            </li>;
          })}</ol> : <EmptyState icon={ShieldAlert} message="No alert evidence matched this observable" />}
        </section>

        <aside className="entity-outcome-lane-v2"><header><h3>Security outcomes</h3><p>Stored incident membership</p></header>{incidents.length ? <ol>{incidents.slice(0, 6).map(incident => {
          const matched = (incident.alert_ids || []).filter(id => orderedAlerts.some(alert => String(alert.id) === String(id)));
          return <li key={incident.id}><button type="button" onClick={() => navigate(`/incidents?incident=${encodeURIComponent(incident.id)}`)}><AlertTriangle aria-hidden="true" /><span><code>{incidentReference(incident.id)}</code><strong>{incident.title}</strong><small>{matched.length} displayed member alert{matched.length === 1 ? '' : 's'}</small></span><ArrowRight aria-hidden="true" /></button></li>;
        })}</ol> : <EmptyState icon={GitMerge} message="No incident contains this evidence" />}</aside>
      </div>

      {incidents.length > 0 && <section className="entity-correlation-chains-v2"><header><GitMerge aria-hidden="true" /><div><h3>Stored correlation chains</h3><p>Alert membership grouped by incident</p></div></header>{incidents.slice(0, 4).map(incident => {
        const chainAlerts = orderedAlerts.filter(alert => (incident.alert_ids || []).map(String).includes(String(alert.id)));
        return <article key={incident.id}><button type="button" onClick={() => navigate(`/incidents?incident=${encodeURIComponent(incident.id)}`)}><code>{incidentReference(incident.id)}</code><strong>{incident.title}</strong></button><div>{chainAlerts.length ? chainAlerts.slice(0, 6).map((alert, index) => <span key={alert.id}>{index > 0 && <i><ArrowRight aria-hidden="true" /></i>}<button type="button" onClick={() => navigate(`/alerts?search=${encodeURIComponent(alert.id)}`)}><b>{alertReference(alert)}</b><small>{activityTitle(alert)}</small></button></span>) : <em>Member alerts are outside the latest displayed sample.</em>}</div></article>;
      })}</section>}

      <footer className="entity-graph-provenance-v2"><Network aria-hidden="true" /><span>Exact stored evidence paths only. The graph does not create or infer correlation.</span></footer>
    </Card>
  );
}
