import {
  Activity, AlertTriangle, BrainCircuit, Check, CircleDashed, Database,
  FileKey2, FileSearch, Fingerprint, GitMerge, Globe2, ScanSearch,
  Server, ShieldCheck, Terminal, UserRound,
} from 'lucide-react';
import { ConfidenceGauge, SeverityBadge, StatusChip } from '../ui';

const ICONS = {
  action:Activity,
  dataset:Database,
  detection:FileSearch,
  file:FileKey2,
  identity:UserRound,
  network:Globe2,
  process:Terminal,
  target:Server,
};

const PHASES = [
  ['observed', 'Observed action'],
  ['evidence', 'Evidence selection'],
  ['inference', 'Model evaluation'],
  ['verdict', 'Verdict'],
  ['correlation', 'Correlation'],
  ['incident', 'Incident decision'],
];

function short(value, limit = 70) {
  const text = String(value || 'Not recorded');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function SceneNode({ icon:Icon, label, value, tone = 'neutral', state, children }) {
  return (
    <div className={`replay-operation-node is-${tone}${state ? ` is-${state}` : ''}`}>
      <span><Icon size={20} strokeWidth={1.5} aria-hidden="true" /></span>
      <small>{label}</small>
      <strong>{short(value, 44)}</strong>
      {children}
    </div>
  );
}

function Flow({ active = true, label }) {
  return (
    <div className={`replay-operation-flow${active ? ' is-active' : ''}`} aria-hidden="true">
      {label && <small>{label}</small>}
      <span><i /></span>
    </div>
  );
}

function Fact({ fact, index = 0, tone = 'neutral' }) {
  const Icon = ICONS[fact.type] || Fingerprint;
  return (
    <li className={`replay-evidence-fact is-${tone}`} style={{ '--replay-order':index }}>
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      <span><small>{fact.label}</small><strong>{short(fact.value)}</strong></span>
    </li>
  );
}

function FactList({ facts = [], tone, empty = 'No structured values were stored' }) {
  if (!facts.length) return <div className="replay-scene-empty"><CircleDashed size={20} strokeWidth={1.5} /><span>{empty}</span></div>;
  return <ul className="replay-evidence-list">{facts.slice(0, 8).map((fact, index) => <Fact key={`${fact.id || fact.label}-${index}`} fact={fact} index={index} tone={tone} />)}</ul>;
}

function Rationale({ label, children, tone = 'neutral' }) {
  return <div className={`replay-recorded-rationale is-${tone}`}><small>{label}</small><p>{children || 'No rationale was stored.'}</p></div>;
}

function ObservedScene({ replay }) {
  return (
    <div className="replay-scene-body is-observed">
      <div className="replay-operation-chain">
        <SceneNode icon={replay.observed.source ? Globe2 : Fingerprint} label="Observed source" value={replay.observed.source || 'Not provided'} />
        <Flow label="activity" />
        <SceneNode icon={Activity} label="Security action" value={replay.observed.action} tone="critical" state="processing" />
        <Flow label="affected" />
        <SceneNode icon={Server} label="Observed target" value={replay.observed.target || 'Not provided'} tone="high" />
      </div>
      <FactList facts={replay.observed.facts} />
    </div>
  );
}

function EvidenceScene({ replay }) {
  return (
    <div className="replay-scene-body is-evidence">
      <div className="replay-processing-map">
        <section><span className="replay-scene-section-label">Inputs presented to the model</span><FactList facts={replay.ai.inputFacts} /></section>
        <Flow label="selected evidence" />
        <SceneNode icon={BrainCircuit} label="Selected AI model" value={replay.ai.model || 'Model not recorded'} tone="accent" state="processing">
          <small className="replay-node-meta">{replay.ai.provider || 'Provider not recorded'}</small>
        </SceneNode>
      </div>
      {replay.ai.limitations.length > 0 && <Rationale label="Evidence gaps declared by the model" tone="warning">{replay.ai.limitations.join(' · ')}</Rationale>}
    </div>
  );
}

function InferenceScene({ replay }) {
  const findings = replay.ai.findings.map((value, index) => ({ id:`finding-${index}`, label:`Finding ${index + 1}`, value, type:'detection' }));
  return (
    <div className="replay-scene-body is-inference">
      <div className="replay-inference-map">
        <section><span className="replay-scene-section-label">Evidence factors retained</span><FactList facts={findings.length ? findings : replay.ai.inputFacts.slice(0, 5)} /></section>
        <div className="replay-model-core" role="img" aria-label={`${replay.ai.model || 'AI model'} evaluating stored evidence`}>
          <i /><BrainCircuit size={32} strokeWidth={1.5} aria-hidden="true" /><strong>Evaluating</strong><small>{short(replay.ai.model, 30)}</small>
        </div>
        <section><Rationale label="Recorded model rationale" tone="accent">{replay.ai.rationale}</Rationale></section>
      </div>
    </div>
  );
}

function VerdictScene({ replay }) {
  const reviewRequired = /needs investigation|true positive/i.test(replay.ai.verdict);
  return (
    <div className="replay-scene-body is-verdict">
      <div className="replay-verdict-map">
        <SceneNode icon={BrainCircuit} label="Model output" value={replay.ai.model || 'Recorded AI'} tone="accent" />
        <Flow label="produced" />
        <div className="replay-verdict-gauge"><ConfidenceGauge value={replay.ai.confidence} label={replay.ai.verdict} /></div>
        <Flow label="routes to" />
        <SceneNode icon={reviewRequired ? UserRound : Check} label="Review path" value={reviewRequired ? 'Analyst review required' : 'Recorded decision'} tone={reviewRequired ? 'high' : 'success'} />
      </div>
      <div className="replay-verdict-facts">
        <SeverityBadge severity={replay.severity} />
        <StatusChip status={reviewRequired ? 'attention' : 'resolved'}>{replay.ai.verdict}</StatusChip>
        {replay.ai.outputFacts.slice(0, 4).map(fact => <span key={fact.id}><small>{fact.label}</small><strong>{short(fact.value, 32)}</strong></span>)}
      </div>
    </div>
  );
}

function CorrelationScene({ replay }) {
  const correlation = replay.ai.correlation;
  return (
    <div className="replay-scene-body is-correlation">
      <div className="replay-operation-chain">
        <SceneNode icon={FileSearch} label="Current alert" value={replay.reference} tone="critical" />
        <Flow label="searches related activity" active={correlation.recorded} />
        <SceneNode icon={ScanSearch} label="Correlation context" value={correlation.inputs.length ? `${correlation.inputs.length} stored inputs` : 'No stored inputs'} tone={correlation.recorded ? 'accent' : 'muted'} state={correlation.recorded ? 'processing' : null} />
        <Flow label="decision" active={correlation.recorded} />
        <SceneNode icon={GitMerge} label="Correlation result" value={correlation.status} tone={correlation.recorded ? 'success' : 'muted'} />
      </div>
      <div className="replay-decision-details">
        <section><span className="replay-scene-section-label">Candidate and match inputs</span><FactList facts={correlation.inputs} empty="No correlation input summary was stored" /></section>
        <section><span className="replay-scene-section-label">Recorded output</span><FactList facts={correlation.outputs} tone={correlation.recorded ? 'success' : 'neutral'} empty="No correlation output was stored" /></section>
      </div>
      <Rationale label="Why this correlation result was recorded">{correlation.reason}</Rationale>
    </div>
  );
}

function IncidentScene({ replay }) {
  const decision = replay.ai.incidentDecision;
  const linked = Boolean(decision.incident);
  return (
    <div className="replay-scene-body is-incident">
      <div className="replay-operation-chain">
        <SceneNode icon={GitMerge} label="Correlation state" value={replay.ai.correlation.status} />
        <Flow label="evaluates policy" active={decision.recorded} />
        <SceneNode icon={ShieldCheck} label="Incident policy gate" value={decision.inputs.length ? `${decision.inputs.length} recorded inputs` : 'Stored decision'} tone="accent" state={decision.recorded ? 'processing' : null} />
        <Flow label={linked ? 'linked' : 'not promoted'} active={decision.recorded} />
        <SceneNode icon={linked ? ShieldCheck : AlertTriangle} label={linked ? decision.incident.reference : 'Incident outcome'} value={linked ? decision.incident.title : decision.status} tone={linked ? 'success' : 'muted'} />
      </div>
      <div className="replay-decision-details">
        <section><span className="replay-scene-section-label">Policy inputs</span><FactList facts={decision.inputs} empty="No incident-policy input summary was stored" /></section>
        <section><span className="replay-scene-section-label">Decision output</span><FactList facts={decision.outputs} tone={linked ? 'success' : 'neutral'} empty={linked ? 'Incident linkage is stored without an output summary' : 'No incident output was stored'} /></section>
      </div>
      <Rationale label="Why this incident decision was recorded" tone={linked ? 'success' : 'neutral'}>{decision.reason}</Rationale>
    </div>
  );
}

export default function AlertReplayScene({ replay, event }) {
  const phase = event?.phase || 'observed';
  const phaseIndex = Math.max(0, PHASES.findIndex(item => item[0] === phase));
  const Scene = phase === 'evidence' ? EvidenceScene
    : phase === 'inference' ? InferenceScene
      : phase === 'verdict' ? VerdictScene
        : phase === 'correlation' ? CorrelationScene
          : phase === 'incident' ? IncidentScene : ObservedScene;

  return (
    <div className={`alert-replay-scene is-${phase}`} key={phase}>
      <header>
        <div><small>Phase {phaseIndex + 1} of {PHASES.length}</small><strong>{PHASES[phaseIndex]?.[1]}</strong></div>
        <span>{event?.title || 'Security action reconstructed'}</span>
      </header>
      <Scene replay={replay} />
    </div>
  );
}
