import {
  AlertTriangle, ArrowRight, Database, GitMerge, Globe2, Network,
  ShieldAlert, UserRound,
} from 'lucide-react';
import { activityTitle, alertReference } from '../lib/executive';
import { relativeTime, severityOf } from '../lib/soc';

const RELATION_FIELDS = [
  ['username', 'identity'],
  ['hostname', 'host'],
  ['agent_name', 'agent'],
  ['src_ip', 'source IP'],
  ['dst_ip', 'destination IP'],
  ['target_db', 'database'],
  ['process', 'process'],
  ['event_dataset', 'dataset'],
];

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function relationToIndicator(alert, indicator) {
  const target = normalized(indicator);
  const matches = RELATION_FIELDS
    .filter(([field]) => normalized(alert[field]).includes(target))
    .map(([field,label]) => ({ label, value:alert[field] }));
  if (matches.length) return matches;
  if (normalized(alert.id).includes(target)) return [{ label:'alert reference', value:alertReference(alert) }];
  return [{ label:'matched evidence', value:'Rule or enrichment content' }];
}

function sharedRelations(left, right) {
  if (!left || !right) return [];
  return RELATION_FIELDS.flatMap(([field,label]) => {
    const leftValue = normalized(left[field]);
    const rightValue = normalized(right[field]);
    return leftValue && leftValue === rightValue ? [{ label, value:left[field] }] : [];
  });
}

function incidentReference(id) {
  return `INC-${String(id).padStart(5, '0')}`;
}

export default function EntityRelationshipGraph({ indicator, observableType, alerts = [], incidents = [], navigate }) {
  const ObservableIcon = observableType?.kind === 'identity'
    ? UserRound
    : observableType?.kind === 'network'
      ? Globe2
      : Database;
  const orderedAlerts = [...alerts]
    .sort((a,b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
    .slice(-10);
  const incidentByAlert = new Map();
  for (const incident of incidents) {
    for (const alertId of incident.alert_ids || []) {
      if (!incidentByAlert.has(String(alertId))) incidentByAlert.set(String(alertId), []);
      incidentByAlert.get(String(alertId)).push(incident);
    }
  }
  const entityValues = new Set(
    orderedAlerts.flatMap(alert => RELATION_FIELDS.map(([field]) => alert[field]).filter(Boolean))
  );
  const representedIncidentAlerts = new Set(
    incidents.flatMap(incident => (incident.alert_ids || []).map(String))
  );

  return (
    <section className="module-panel entity-relationship-panel">
      <div className="panel-heading">
        <div><Network /><span><strong>Evidence relationship map</strong><small>Exact paths from the investigated observable to alerts, shared entities, and stored incidents</small></span></div>
        <span className="legend"><i className="observed" />Entity match <i className="triggered" />Alert evidence <i className="correlated" />Incident membership</span>
      </div>

      <div className="entity-map-summary">
        <article><strong>{orderedAlerts.length}</strong><span>latest alerts mapped</span></article>
        <article><strong>{entityValues.size}</strong><span>distinct related values</span></article>
        <article><strong>{incidents.length}</strong><span>stored incidents</span></article>
        <p><GitMerge /> Lines describe observed equality or stored incident membership. They are not model-inferred relationships.</p>
      </div>

      <div className="entity-map">
        <aside className="entity-map-anchor">
          <small>Investigated observable</small>
          <div><ObservableIcon /><span>{observableType?.label || 'Security observable'}</span><strong>{indicator}</strong></div>
          <p>Every alert shown matched this value in a stored alert field, rule description, or enrichment record.</p>
        </aside>

        <div className="entity-alert-lane" aria-label="Related alert evidence">
          <header><ShieldAlert /><span><strong>Alert evidence</strong><small>Oldest to newest · latest 10 matches</small></span></header>
          {orderedAlerts.map((alert,index) => {
            const direct = relationToIndicator(alert, indicator);
            const shared = sharedRelations(orderedAlerts[index - 1], alert);
            const linkedIncidents = incidentByAlert.get(String(alert.id)) || [];
            return (
              <article className="entity-alert-node" key={alert.id}>
                {index > 0 && (
                  <div className="entity-peer-edge">
                    <span>{shared.length
                      ? shared.slice(0,2).map(item => `${item.label}: ${item.value}`).join(' · ')
                      : 'same pivot, no additional exact peer field'}</span>
                  </div>
                )}
                <div className="entity-direct-edge"><span>{direct[0].label}</span></div>
                <button type="button" onClick={() => navigate(`/alerts?search=${encodeURIComponent(alert.id)}`)}>
                  <span className={`entity-alert-severity ${severityOf(alert)}`}><ShieldAlert /></span>
                  <span>
                    <code>{alertReference(alert)}</code>
                    <strong>{activityTitle(alert)}</strong>
                    <small>{relativeTime(alert.timestamp)} · {alert.event_dataset || alert.agent_name || 'Stored alert'}</small>
                  </span>
                  <ArrowRight />
                </button>
                <div className="entity-alert-links">
                  {direct.slice(0,3).map(item => <span key={`${item.label}-${item.value}`}><b>{item.label}</b>{item.value}</span>)}
                  {linkedIncidents.map(incident => <span className="incident" key={incident.id}><b>incident</b>{incidentReference(incident.id)}</span>)}
                </div>
              </article>
            );
          })}
          {!orderedAlerts.length && <div className="entity-graph-empty"><ShieldAlert /><span>No alert evidence matched this observable.</span></div>}
        </div>

        <aside className="entity-outcome-lane">
          <header><AlertTriangle /><span><strong>Security outcomes</strong><small>Stored incident membership</small></span></header>
          {incidents.slice(0,6).map(incident => {
            const matched = (incident.alert_ids || []).filter(id => orderedAlerts.some(alert => String(alert.id) === String(id)));
            return (
              <button key={incident.id} type="button" onClick={() => navigate(`/incidents?incident=${encodeURIComponent(incident.id)}`)}>
                <span className={`entity-incident-icon ${incident.severity || 'medium'}`}><AlertTriangle /></span>
                <span><code>{incidentReference(incident.id)}</code><strong>{incident.title}</strong><small>{matched.length} displayed alert{matched.length === 1 ? '' : 's'} belongs to this incident</small></span>
                <ArrowRight />
              </button>
            );
          })}
          {!incidents.length && <div className="entity-graph-empty"><GitMerge /><span>No incident currently contains matching alert evidence.</span></div>}
        </aside>
      </div>

      <div className="entity-correlation-chains">
        <header><GitMerge /><span><strong>Stored correlation chains</strong><small>Alert-to-alert membership grouped by incident</small></span></header>
        {incidents.slice(0,4).map(incident => {
          const chainAlerts = orderedAlerts.filter(alert => (incident.alert_ids || []).map(String).includes(String(alert.id)));
          return (
            <article key={incident.id}>
              <button type="button" onClick={() => navigate(`/incidents?incident=${encodeURIComponent(incident.id)}`)}>
                <code>{incidentReference(incident.id)}</code><strong>{incident.title}</strong>
              </button>
              <div>
                {chainAlerts.slice(0,6).map((alert,index) => (
                  <span key={alert.id}>
                    {index > 0 && <i><ArrowRight /></i>}
                    <button type="button" onClick={() => navigate(`/alerts?search=${encodeURIComponent(alert.id)}`)}>
                      <b>{alertReference(alert)}</b><small>{activityTitle(alert)}</small>
                    </button>
                  </span>
                ))}
                {!chainAlerts.length && <em>Incident matched the observable, but its member alerts are outside the latest displayed alert sample.</em>}
              </div>
            </article>
          );
        })}
        {!incidents.length && (
          <p className="entity-chain-empty">
            <Globe2 /> Alerts are connected to the searched observable, but no stored incident chain exists yet.
          </p>
        )}
        {incidents.length > 0 && representedIncidentAlerts.size === 0 && (
          <p className="entity-chain-empty"><Database /> Incident membership exists outside the latest displayed alert sample.</p>
        )}
      </div>
    </section>
  );
}
