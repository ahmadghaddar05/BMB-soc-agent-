import {
  AlertTriangle, Bot, Check, CircleDashed, GitMerge, Link2,
  ShieldCheck, Sparkles,
} from 'lucide-react';
import { fmtTs } from '../lib/api';

function object(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function latest(events, stage) {
  return [...events].reverse().find(event => event.stage === stage);
}

function label(value) {
  return String(value || 'not recorded').replaceAll('_', ' ');
}

function outcomeLabel(value) {
  const outcome = String(value || '').toLowerCase();
  if (outcome === 'created') return 'Created this incident';
  if (outcome === 'updated') return 'Updated this incident';
  if (outcome === 'unchanged') return 'Matched an existing incident';
  if (outcome === 'preserved') return 'Matched a closed incident';
  return outcome ? label(outcome) : 'Decision recorded';
}

function sharedLinks(alerts = []) {
  const definitions = [
    ['Identity', alert => alert.username],
    ['Host', alert => alert.hostname || alert.agent_name],
    ['Source IP', alert => alert.src_ip],
    ['Destination IP', alert => alert.dst_ip],
    ['Database', alert => alert.target_db],
    ['Process', alert => alert.process],
  ];
  const links = [];
  for (const [type, getter] of definitions) {
    const counts = new Map();
    for (const alert of alerts) {
      const value = String(getter(alert) || '').trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    for (const [value, count] of counts) {
      if (count >= 2) links.push({ type, value, count });
    }
  }
  return links.sort((a, b) => b.count - a.count).slice(0, 8);
}

function confidence(event, incident) {
  const value = Number(event?.confidence ?? incident?.confidence);
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'Not supplied';
}

export default function IncidentCorrelationTrace({ incident, alerts, journey, loading, error }) {
  const stages = journey?.stages || [];
  const outcomes = journey?.correlation?.alert_outcomes || [];
  const coverage = journey?.correlation?.coverage || {};
  const decision = latest(stages, 'incident_decision');
  const correlated = outcomes.filter(event => event.stage === 'correlated');
  const alertDecisions = outcomes.filter(event => event.stage === 'incident_decision');
  const sourceEvent = [...correlated].reverse().find(event => event.executor_type === 'ai') || decision;
  const output = object(decision?.output_summary);
  const links = sharedLinks(alerts);
  const total = Number(coverage.total_alerts ?? alerts.length ?? 0);
  const recorded = Number(coverage.correlation_recorded ?? correlated.length);
  const decisionRecorded = Number(coverage.incident_decision_recorded ?? alertDecisions.length);
  const hasMembership = total > 0;
  const hasDecisionProvenance = Boolean(decision || outcomes.length);

  return (
    <section className="incident-correlation-trace" aria-labelledby="incident-correlation-title">
      <header>
        <div>
          <span><GitMerge />Correlation decision trace</span>
          <h2 id="incident-correlation-title">Why were these alerts grouped?</h2>
          <p>Recorded correlation evidence and server validation—not a reconstructed explanation.</p>
        </div>
        <span className={`correlation-trace-state ${decision ? 'recorded' : hasMembership ? 'current' : 'missing'}`}>
          {decision ? <Check /> : hasMembership ? <Link2 /> : <CircleDashed />}
          {decision ? 'Decision recorded' : hasMembership ? 'Membership recorded' : 'Decision not recorded'}
        </span>
      </header>

      {loading ? (
        <div className="correlation-trace-message" role="status"><i className="trace-spinner" />Loading correlation provenance…</div>
      ) : error ? (
        <div className="correlation-trace-message error" role="alert"><AlertTriangle />Correlation provenance could not be loaded. Incident evidence remains available below.</div>
      ) : !hasDecisionProvenance && !hasMembership ? (
        <div className="correlation-trace-message"><CircleDashed />This incident has no append-only correlation decision. It may predate workflow provenance; missing history is not inferred.</div>
      ) : (
        <>
          {!hasDecisionProvenance && (
            <div className="correlation-trace-message is-current"><Link2 />The incident and its alert membership are stored, but the original correlation ledger events are unavailable. Current state is shown without reconstructing an AI decision.</div>
          )}
          <div className="correlation-trace-facts">
            <article>
              <span>Incident outcome</span>
              <strong>{decision ? outcomeLabel(output.persistence_status) : 'Current membership stored'}</strong>
              <small>{decision?.reason || 'The incident record links the alerts shown below.'}</small>
            </article>
            <article>
              <span>Model confidence</span>
              <strong>{confidence(sourceEvent, incident)}</strong>
              <small>Model score, not proof of compromise</small>
            </article>
            <article>
              <span>Evidence coverage</span>
              <strong>{recorded}/{total || '—'} ledger records</strong>
              <small>{decisionRecorded}/{total || '—'} incident-decision records available</small>
            </article>
            <article>
              <span>Decision source</span>
              <strong>{sourceEvent?.executor_type === 'ai' ? 'AI-assisted' : sourceEvent ? 'System recorded' : 'Current database state'}</strong>
              <small>{sourceEvent?.model || sourceEvent?.provider || 'Original model identity unavailable'}</small>
            </article>
          </div>

          <div className="correlation-link-summary">
            <div>
              <span><Link2 />Observed shared links</span>
              <p>Values appearing in at least two alerts in this incident.</p>
            </div>
            <div className="correlation-link-chips">
              {links.map(link => (
                <span key={`${link.type}-${link.value}`}>
                  <small>{link.type}</small>
                  <strong>{link.value}</strong>
                  <em>{link.count} alerts</em>
                </span>
              ))}
              {!links.length && <p>No repeated identity, host, IP, database, or process is visible in the returned alert fields.</p>}
            </div>
          </div>

          <details className="correlation-evidence-details">
            <summary><Sparkles />Review per-alert correlation decisions <span>{outcomes.length} records</span></summary>
            <div>
              {(incident.alert_ids || []).map(alertId => {
                const correlation = correlated.find(event => String(event.alert_id) === String(alertId));
                const incidentDecision = alertDecisions.find(event => String(event.alert_id) === String(alertId));
                return (
                  <article key={alertId}>
                    <code>{alertId}</code>
                    <span className={correlation?.status || 'missing'}>{correlation?.status || 'Not recorded'}</span>
                    <p>{correlation?.reason || 'No correlation-stage record exists for this alert.'}</p>
                    <small>
                      Incident decision: {incidentDecision?.status || 'not recorded'}
                      {incidentDecision?.created_at ? ` · ${fmtTs(incidentDecision.created_at)}` : ''}
                    </small>
                  </article>
                );
              })}
            </div>
          </details>
        </>
      )}

      <footer>
        <ShieldCheck />
        <p><strong>How to interpret this</strong><span>Hermes proposes a group; BMB independently validates alert IDs, shared entities, time proximity, overlap, and persistence. The analyst still confirms the incident and response plan.</span></p>
        <Bot />
      </footer>
    </section>
  );
}
