import {
  AlertTriangle, Bot, Check, CircleDashed, Clock3, Database,
  GitMerge, Layers3, Link2, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { fmtTs, verdictLabel } from '../lib/api';
import { Button, EmptyState, SkeletonLoader, StatusChip, Timeline } from './ui';

const STAGES = [
  { key:'collected', label:'Evidence received', description:'Accepted from the configured security source.', icon:Database },
  { key:'normalized', label:'Evidence normalized', description:'Mapped into the canonical BMB alert schema.', icon:Layers3 },
  { key:'enriched', label:'Context evaluated', description:'Checked against available identity, asset, endpoint, and threat context.', icon:Sparkles },
  { key:'triaged', label:'Model assessment', description:'Assessed using the stored evidence and active policy.', icon:Bot },
  { key:'correlated', label:'Correlation evaluated', description:'Compared with related activity in the configured correlation window.', icon:GitMerge },
  { key:'incident_decision', label:'Incident decision', description:'Promoted, updated, or retained as alert activity.', icon:ShieldCheck },
];

const STATUS_ICON = {
  completed:Check,
  failed:X,
  skipped:CircleDashed,
  running:Clock3,
  pending:Clock3,
  current:Link2,
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

function displayValue(value) {
  if (value == null || value === '') return 'Not supplied';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function RecordedDetails({ event }) {
  const input = Object.entries(object(event.input_summary));
  const output = Object.entries(object(event.output_summary));
  const limitations = list(event.limitations);
  return (
    <div className="triage-recorded-details">
      <dl>
        <div><dt>Executor</dt><dd>{displayExecutor(event)}</dd></div>
        <div><dt>Actor</dt><dd>{event.actor || 'Not recorded'}</dd></div>
        <div><dt>Provider</dt><dd>{event.provider || 'Not applicable'}</dd></div>
        <div><dt>Model</dt><dd>{event.model || 'Not applicable'}</dd></div>
        <div><dt>Confidence</dt><dd>{confidence(event)}</dd></div>
        <div><dt>Completed</dt><dd>{fmtTs(event.finished_at || event.created_at)}</dd></div>
      </dl>
      {(input.length > 0 || output.length > 0) && (
        <div className="triage-recorded-summaries">
          {input.length > 0 && <section><h4>Bounded input</h4>{input.map(([key, value]) => <p key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{displayValue(value)}</strong></p>)}</section>}
          {output.length > 0 && <section><h4>Recorded output</h4>{output.map(([key, value]) => <p key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{displayValue(value)}</strong></p>)}</section>}
        </div>
      )}
      {limitations.length > 0 && <section className="triage-recorded-limitations"><h4>Recorded limitations</h4><ul>{limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
      {event.error_message && <p className="triage-recorded-error"><AlertTriangle />{event.error_message}</p>}
    </div>
  );
}

function traceItems(events, includeAll = false) {
  const recorded = latestByStage(events);
  const stages = includeAll ? STAGES : STAGES.slice(0, 4);
  return stages.flatMap(stage => {
    const event = recorded.get(stage.key);
    if (!event && !includeAll) return [];
    const Icon = stage.icon;
    return [{
      id:stage.key,
      title:stage.label,
      detail:event?.reason || stage.description,
      meta:event ? (event.status === 'completed' ? displayExecutor(event) : String(event.status || 'Recorded')) : 'Not recorded',
      icon:<Icon aria-hidden="true" />,
      expandedLabel:event ? 'Inspect recorded evidence' : null,
      expandedContent:event ? <RecordedDetails event={event} /> : null,
    }];
  });
}

export function TriageDecisionSummary({ journey, loading, error, verdict, onOpenWorkflow }) {
  const events = journey?.stages || [];
  const triage = [...events].reverse().find(event => event.stage === 'triaged');
  const output = object(triage?.output_summary);
  const limitations = list(triage?.limitations);
  const items = traceItems(events);

  return (
    <section className="triage-decision-trace" aria-labelledby="decision-trace-title">
      <header>
        <div><span>AI decision trace</span><h3 id="decision-trace-title">Why this assessment?</h3></div>
        <Button variant="secondary" onClick={onOpenWorkflow}>View full workflow</Button>
      </header>
      {loading ? (
        <SkeletonLoader lines={3} />
      ) : error ? (
        <EmptyState icon={AlertTriangle} message="Decision trace is temporarily unavailable" />
      ) : !triage ? (
        <EmptyState icon={CircleDashed} message="This alert is waiting for AI triage" />
      ) : (
        <>
          <div className="triage-decision-summary">
            <StatusChip status="active">{verdictLabel(output.verdict || verdict?.verdict)}</StatusChip>
            <span>{confidence(triage)} model confidence</span>
            <span>{displayExecutor(triage)}</span>
          </div>
          <Timeline items={items} className="triage-reasoning-timeline" />
          <div className={`triage-limitations ${limitations.length ? 'has-limitations' : ''}`}>
            <strong>{limitations.length ? 'Known evidence limitations' : 'No explicit limitation supplied'}</strong>
            {limitations.length
              ? <ul>{limitations.slice(0, 3).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
              : <p>The model did not record a limitation. Verify cited evidence before acting.</p>}
          </div>
          <p className="triage-trust-note">This explains the recorded workflow; it does not independently prove the verdict is correct.</p>
        </>
      )}
    </section>
  );
}

export function TriageWorkflow({ journey, loading, error }) {
  const events = journey?.stages || [];
  const recorded = latestByStage(events);
  const linkedIncident = journey?.current_state?.incident || null;
  const hasCorrelationDecision = recorded.has('correlated');

  if (loading) return <section className="triage-workflow-state"><SkeletonLoader lines={5} /></section>;
  if (error) return <EmptyState icon={AlertTriangle} message="Recorded workflow is temporarily unavailable" />;
  if (!events.length) return <EmptyState icon={CircleDashed} message="No processing history has been recorded yet" />;

  const workflowItems = STAGES.map(stage => {
    const recordedEvent = recorded.get(stage.key);
    const currentStateEvent = !recordedEvent && linkedIncident && stage.key === 'correlated'
      ? { status:'current', reason:`Currently linked to incident INC-${String(linkedIncident.id).padStart(5, '0')}. The original correlation ledger event is unavailable.` }
      : !recordedEvent && linkedIncident && stage.key === 'incident_decision'
        ? { status:'current', reason:`The linked incident is currently ${String(linkedIncident.status || 'recorded').replaceAll('_', ' ')}. This is database state, not reconstructed AI provenance.` }
        : null;
    const event = recordedEvent || currentStateEvent;
    const Icon = stage.icon;
    const StatusIcon = STATUS_ICON[event?.status] || CircleDashed;
    return {
      id:stage.key,
      title:stage.label,
      detail:event?.reason || stage.description,
      meta:event?.status === 'current' ? 'Current state' : event?.status || 'Not recorded',
      icon:<Icon aria-hidden="true" />,
      expandedLabel:recordedEvent ? 'Inspect recorded evidence' : null,
      expandedContent:recordedEvent ? <RecordedDetails event={recordedEvent} /> : null,
      statusIcon:<StatusIcon />,
    };
  });

  return (
    <section className="triage-workflow" aria-labelledby="workflow-title">
      <header>
        <div><span>Recorded provenance</span><h3 id="workflow-title">How this alert was processed</h3></div>
        <StatusChip>{events.length} append-only event{events.length === 1 ? '' : 's'}</StatusChip>
      </header>
      <p className="triage-workflow-trust"><ShieldCheck />Recorded workflow and current state. Ledger events are append-only; missing history is not inferred.</p>
      {!hasCorrelationDecision && !linkedIncident && (
        <p className="triage-workflow-awaiting"><GitMerge /><span><strong>Awaiting BMB correlation processing.</strong> A detection title can describe repeated activity without being a recorded BMB correlation result.</span></p>
      )}
      <Timeline items={workflowItems} className="triage-workflow-timeline" />
    </section>
  );
}
