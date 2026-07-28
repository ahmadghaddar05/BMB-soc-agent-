import {
  AlertTriangle, Bot, Check, CircleDashed, Clock3, Database,
  GitMerge, Layers3, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { fmtTs, verdictLabel } from '../lib/api';

const STAGES = [
  { key:'collected', label:'Collected', description:'Received from the configured security source.', icon:Database },
  { key:'normalized', label:'Normalized', description:'Mapped into the BMB alert schema.', icon:Layers3 },
  { key:'enriched', label:'Enriched', description:'Checked against available security context.', icon:Sparkles },
  { key:'triaged', label:'Triaged', description:'Assessed using stored evidence and policy.', icon:Bot },
  { key:'correlated', label:'Correlation', description:'Evaluated against related activity.', icon:GitMerge },
  { key:'incident_decision', label:'Incident decision', description:'Promoted, updated, or left as activity.', icon:ShieldCheck },
];

const STATUS_ICON = {
  completed: Check,
  failed: X,
  skipped: CircleDashed,
  running: Clock3,
  pending: Clock3,
};

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

function list(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.trim());
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim()) : [];
  } catch {
    return [];
  }
}

function displayExecutor(event) {
  if (!event) return 'Not recorded';
  if (event.executor_type === 'cache') return 'Verified cached decision';
  if (event.executor_type === 'ai') return 'AI-assisted';
  if (event.executor_type === 'analyst') return 'Analyst decision';
  return 'System process';
}

function confidence(event) {
  const value = Number(event?.confidence);
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'Not supplied';
}

function latestByStage(events = []) {
  const result = new Map();
  for (const event of events) result.set(event.stage, event);
  return result;
}

export function TriageDecisionSummary({ journey, loading, error, verdict, onOpenWorkflow }) {
  const events = journey?.stages || [];
  const triage = [...events].reverse().find(event => event.stage === 'triaged');
  const output = object(triage?.output_summary);
  const limitations = list(triage?.limitations);

  return (
    <section className="decision-trace-summary" aria-labelledby="decision-trace-title">
      <div className="decision-trace-heading">
        <div>
          <span><Bot />AI decision trace</span>
          <h3 id="decision-trace-title">Why this assessment?</h3>
        </div>
        <button type="button" onClick={onOpenWorkflow}>View full workflow</button>
      </div>
      {loading ? (
        <div className="decision-trace-state"><i className="trace-spinner" />Loading recorded workflow…</div>
      ) : error ? (
        <div className="decision-trace-state is-error"><AlertTriangle />Workflow evidence could not be loaded. The stored verdict remains visible.</div>
      ) : !triage ? (
        <div className="decision-trace-state"><CircleDashed />No recorded triage stage exists for this alert. Missing history is not inferred.</div>
      ) : (
        <>
          <p className="decision-reason">{triage.reason || verdict?.narrative || 'No model explanation was recorded.'}</p>
          <dl className="decision-facts">
            <div><dt>Decision</dt><dd>{verdictLabel(output.verdict || verdict?.verdict)}</dd></div>
            <div><dt>Confidence</dt><dd>{confidence(triage)} <small>{triage.confidence_kind || 'score type not recorded'}</small></dd></div>
            <div><dt>Decision source</dt><dd>{displayExecutor(triage)} <small>{triage.provider || 'provider not recorded'}</small></dd></div>
            <div><dt>Model</dt><dd title={triage.model || ''}>{triage.model || 'Not recorded'}</dd></div>
            <div><dt>Evidence citations</dt><dd>{Number(output.citation_count || 0)} recorded</dd></div>
            <div><dt>Limitations</dt><dd>{limitations.length ? `${limitations.length} recorded` : 'None supplied'}</dd></div>
          </dl>
          <p className="decision-trust-note">This explains the recorded workflow; it does not independently prove the verdict is correct.</p>
        </>
      )}
    </section>
  );
}

function StageDetails({ event }) {
  const input = object(event.input_summary);
  const output = object(event.output_summary);
  const limitations = list(event.limitations);
  const inputItems = Object.entries(input);
  const outputItems = Object.entries(output);

  return (
    <details className="workflow-stage-details">
      <summary>Recorded details</summary>
      <div className="workflow-detail-grid">
        <dl>
          <div><dt>Executor</dt><dd>{displayExecutor(event)}</dd></div>
          <div><dt>Actor</dt><dd>{event.actor || 'Not recorded'}</dd></div>
          <div><dt>Provider</dt><dd>{event.provider || 'Not applicable'}</dd></div>
          <div><dt>Model</dt><dd>{event.model || 'Not applicable'}</dd></div>
          <div><dt>Confidence</dt><dd>{confidence(event)}</dd></div>
          <div><dt>Completed</dt><dd>{fmtTs(event.finished_at || event.created_at)}</dd></div>
        </dl>
        {(inputItems.length > 0 || outputItems.length > 0) && (
          <div className="workflow-recorded-summary">
            {inputItems.length > 0 && <section><h5>Bounded input summary</h5>{inputItems.map(([key, value]) => <p key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong></p>)}</section>}
            {outputItems.length > 0 && <section><h5>Recorded output summary</h5>{outputItems.map(([key, value]) => <p key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong></p>)}</section>}
          </div>
        )}
      </div>
      {limitations.length > 0 && <div className="workflow-limitations"><strong>Recorded limitations</strong><ul>{limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
      {event.error_message && <div className="workflow-error"><AlertTriangle />{event.error_message}</div>}
    </details>
  );
}

export function TriageWorkflow({ journey, loading, error }) {
  const events = journey?.stages || [];
  const recorded = latestByStage(events);

  if (loading) return <section className="workflow-empty"><i className="trace-spinner" /><strong>Loading recorded workflow</strong><span>Reading append-only provenance for this alert.</span></section>;
  if (error) return <section className="workflow-empty is-error"><AlertTriangle /><strong>Workflow unavailable</strong><span>The provenance endpoint could not be read. No workflow state has been inferred.</span></section>;
  if (!events.length) return <section className="workflow-empty"><CircleDashed /><strong>No recorded workflow yet</strong><span>This alert may predate workflow provenance or may not have entered processing. Missing stages are not inferred.</span></section>;

  return (
    <section className="triage-workflow" aria-labelledby="workflow-title">
      <header>
        <div><span>Recorded provenance</span><h3 id="workflow-title">How this alert was processed</h3></div>
        <p>{events.length} append-only event{events.length === 1 ? '' : 's'}</p>
      </header>
      <div className="workflow-trust-banner"><ShieldCheck /><p><strong>Observed workflow only</strong><span>Missing stages are not inferred. Stages without a ledger event are shown as not recorded.</span></p></div>
      <ol className="workflow-stage-list">
        {STAGES.map(stage => {
          const event = recorded.get(stage.key);
          const Icon = stage.icon;
          const StatusIcon = STATUS_ICON[event?.status] || CircleDashed;
          return (
            <li key={stage.key} className={`workflow-stage workflow-${event?.status || 'missing'}`}>
              <span className="workflow-stage-icon"><Icon /></span>
              <div className="workflow-stage-body">
                <div className="workflow-stage-title">
                  <div><h4>{stage.label}</h4><p>{event?.reason || stage.description}</p></div>
                  <span><StatusIcon />{event?.status || 'Not recorded'}</span>
                </div>
                {event && <StageDetails event={event} />}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
