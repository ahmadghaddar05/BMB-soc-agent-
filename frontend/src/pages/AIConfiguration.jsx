import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, GitMerge, Play, RefreshCw, Save,
  ShieldCheck, Sparkles, Workflow,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api, fmtDuration, fmtTs } from '../lib/api';

const SECTIONS = ['triage', 'correlation', 'workflow'];

const DEFAULTS = Object.freeze({
  triage: {
    triage_enabled:'false', triage_mode:'pipeline', triage_token_budget:'60000',
    caching_enabled:'true', triage_cache_ttl_hours:'168', agentic_max_iterations:'3',
    hybrid_agentic_min_rule_level:'12', hybrid_agentic_confidence_below:'0.82',
  },
  correlation: {
    correlation_enabled:'false', correlation_lookback_hours:'24',
    correlation_entity_window_hours:'6', correlation_max_alerts:'40',
    correlation_token_budget:'20000',
  },
  workflow: {
    autonomous_agent_enabled:'false', autonomous_lookback_hours:'24',
    autonomous_min_confidence:'0.70', autonomous_max_items:'20',
    autonomous_assignment_enabled:'true', autonomous_default_owner:'SOC Analyst',
    simulated_response_proposals_enabled:'false',
  },
});

function valuesFor(section, settings = {}) {
  return Object.fromEntries(Object.entries(DEFAULTS[section]).map(([key, fallback]) => [key, settings[key] ?? fallback]));
}

function initialDrafts() {
  return Object.fromEntries(SECTIONS.map(section => [section, { ...DEFAULTS[section] }]));
}

function integerError(value, min, max, label) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max
    ? null : `${label} must be a whole number between ${min.toLocaleString()} and ${max.toLocaleString()}.`;
}

function ratioError(value, label) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1
    ? null : `${label} must be between 0 and 1.`;
}

function validate(section, draft) {
  if (section === 'triage') {
    return integerError(draft.triage_token_budget, 10000, 500000, 'Token budget')
      || integerError(draft.triage_cache_ttl_hours, 1, 720, 'Cache lifetime')
      || integerError(draft.agentic_max_iterations, 2, 4, 'Maximum review iterations')
      || integerError(draft.hybrid_agentic_min_rule_level, 1, 20, 'Deeper-review rule level')
      || ratioError(draft.hybrid_agentic_confidence_below, 'Deeper-review confidence');
  }
  if (section === 'correlation') {
    return integerError(draft.correlation_lookback_hours, 1, 168, 'Look-back window')
      || integerError(draft.correlation_entity_window_hours, 1, 48, 'Entity-link window')
      || integerError(draft.correlation_max_alerts, 2, 80, 'Candidate cap')
      || integerError(draft.correlation_token_budget, 6000, 100000, 'Token budget');
  }
  const owner = String(draft.autonomous_default_owner || '').trim();
  return integerError(draft.autonomous_lookback_hours, 1, 168, 'Evidence look-back')
    || integerError(draft.autonomous_max_items, 1, 100, 'Maximum work items')
    || ratioError(draft.autonomous_min_confidence, 'Minimum confidence')
    || (!owner || owner.length > 120 ? 'Proposed owner must contain between 1 and 120 characters.' : null);
}

function readable(value) {
  return String(value || 'unknown').replaceAll('_', ' ');
}

function booleanFact(value) {
  return value === true ? 'Enabled' : value === false ? 'Disabled' : 'Unknown';
}

function healthTone(status) {
  if (status === 'online' || status === 'completed') return 'success';
  if (status === 'running' || status === 'partial') return 'attention';
  if (status === 'failed' || status === 'degraded' || status === 'error') return 'critical';
  return 'neutral';
}

function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-violet-500' : 'bg-slate-700'}`}>
      <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function Panel({ icon:Icon, title, subtitle, action, children }) {
  return (
    <section className="module-panel">
      <header className="panel-heading">
        <div><Icon aria-hidden="true" /><span><strong>{title}</strong><small>{subtitle}</small></span></div>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Fact({ label, value, detail }) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-semibold text-[var(--text)]">{value ?? '—'}</dd>
      {detail && <small className="mt-1 block text-xs leading-5 text-[var(--muted)]">{detail}</small>}
    </div>
  );
}

function PolicyRow({ label, hint, children }) {
  return (
    <div className="grid gap-3 border-b border-[var(--border-soft)] py-4 last:border-0 md:grid-cols-[minmax(220px,.8fr)_minmax(260px,1.2fr)] md:items-center">
      <div><strong className="block text-sm font-medium text-[var(--text)]">{label}</strong>{hint && <small className="mt-1 block max-w-xl text-xs leading-5 text-[var(--muted)]">{hint}</small>}</div>
      <div className="md:justify-self-end">{children}</div>
    </div>
  );
}

function Feedback({ value }) {
  if (!value) return null;
  const danger = value.tone === 'danger';
  return (
    <div className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${danger ? 'border-rose-500/35 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`} role={danger ? 'alert' : 'status'}>
      {danger ? <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />}
      <span>{value.text}</span>
    </div>
  );
}

function NumberControl({ value, onChange, min, max, step = 1, suffix, disabled }) {
  return (
    <span className="flex items-center gap-2">
      <input className="input h-9 w-36" type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={event => onChange(event.target.value)} />
      {suffix && <small className="whitespace-nowrap text-xs text-[var(--muted)]">{suffix}</small>}
    </span>
  );
}

function SaveBar({ dirty, saving, onSave }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-4">
      <span className="text-xs text-[var(--muted)]">{dirty ? 'Unsaved policy changes' : 'Saved policy is shown'}</span>
      <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={onSave}>
        {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saving ? 'Saving…' : 'Save policy'}
      </button>
    </div>
  );
}

export default function AIConfiguration() {
  const [snapshot, setSnapshot] = useState({ dependencies:null, runtime:null, settings:null, agent:null });
  const [drafts, setDrafts] = useState(initialDrafts);
  const [dirty, setDirty] = useState({ triage:false, correlation:false, workflow:false });
  const [saving, setSaving] = useState({ triage:false, correlation:false, workflow:false });
  const [feedback, setFeedback] = useState({ triage:null, correlation:null, workflow:null });
  const [actions, setActions] = useState({ correlation:null, workflow:null });
  const [running, setRunning] = useState({ correlation:false, workflow:false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const dirtyRef = useRef({ triage:false, correlation:false, workflow:false });
  const savingRef = useRef(false);
  const requestRef = useRef(null);

  const load = useCallback(async ({ initial = false } = {}) => {
    if (savingRef.current) return;
    requestRef.current?.abort();
    const controller = new window.AbortController();
    requestRef.current = controller;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const results = await Promise.allSettled([
        api('/health/dependencies', { signal:controller.signal }),
        api('/admin/runtime', { signal:controller.signal }),
        api('/settings', { signal:controller.signal }),
        api('/agent/status', { signal:controller.signal }),
      ]);
      if (requestRef.current !== controller) return;
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length === results.length) throw failures[0].reason;
      const dependencies = results[0].status === 'fulfilled' ? results[0].value : null;
      const runtime = results[1].status === 'fulfilled' ? results[1].value : null;
      const settingsResponse = results[2].status === 'fulfilled' ? results[2].value : null;
      const agent = results[3].status === 'fulfilled' ? results[3].value : null;
      setSnapshot(current => ({
        dependencies:dependencies ?? current.dependencies,
        runtime:runtime ?? current.runtime,
        settings:settingsResponse?.settings ?? current.settings,
        agent:agent ?? current.agent,
      }));
      if (settingsResponse?.settings) {
        setDrafts(current => Object.fromEntries(SECTIONS.map(section => [
          section,
          dirtyRef.current[section] ? current[section] : valuesFor(section, settingsResponse.settings),
        ])));
      }
      setLoadError(failures.map(result => result.reason?.message || 'A configuration endpoint did not respond.').join(' '));
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      if (error?.name !== 'AbortError') setLoadError(error?.message || 'AI configuration could not be loaded.');
    } finally {
      if (requestRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load({ initial:true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = setInterval(refreshWhenVisible, 30000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      requestRef.current?.abort();
    };
  }, [load]);

  function update(section, key, value) {
    dirtyRef.current[section] = true;
    setDirty(current => ({ ...current, [section]:true }));
    setFeedback(current => ({ ...current, [section]:null }));
    setDrafts(current => ({ ...current, [section]:{ ...current[section], [key]:value } }));
  }

  async function saveSection(section) {
    const error = validate(section, drafts[section]);
    if (error) {
      setFeedback(current => ({ ...current, [section]:{ tone:'danger', text:error } }));
      return;
    }
    requestRef.current?.abort();
    savingRef.current = true;
    setSaving(current => ({ ...current, [section]:true }));
    setFeedback(current => ({ ...current, [section]:null }));
    try {
      const response = await api('/settings', { method:'PUT', body:JSON.stringify(drafts[section]) });
      const settings = response.settings || { ...(snapshot.settings || {}), ...drafts[section] };
      setSnapshot(current => ({ ...current, settings }));
      setDrafts(current => ({ ...current, [section]:valuesFor(section, settings) }));
      dirtyRef.current[section] = false;
      setDirty(current => ({ ...current, [section]:false }));
      setFeedback(current => ({ ...current, [section]:{ tone:'success', text:'Policy saved successfully.' } }));
    } catch (saveError) {
      setFeedback(current => ({ ...current, [section]:{ tone:'danger', text:saveError.message || 'Policy could not be saved.' } }));
    } finally {
      savingRef.current = false;
      setSaving(current => ({ ...current, [section]:false }));
      load();
    }
  }

  async function runInternal(kind) {
    const endpoint = kind === 'correlation' ? '/scheduler/correlate-now' : '/agent/run-now';
    setRunning(current => ({ ...current, [kind]:true }));
    setActions(current => ({ ...current, [kind]:null }));
    try {
      const result = await api(endpoint, { method:'POST', body:'{}' });
      if (kind === 'correlation') {
        setActions(current => ({ ...current, correlation:{
          tone:'success',
          text:`Internal correlation completed: ${Number(result.incidents_created || 0).toLocaleString()} created and ${Number(result.incidents_updated || 0).toLocaleString()} updated.`,
        } }));
      } else {
        const metrics = result.metrics || {};
        setActions(current => ({ ...current, workflow:{
          tone:result.status === 'failed' || result.status === 'partial' ? 'danger' : 'success',
          text:`Internal workflow review ${readable(result.status)}: ${Number(metrics.investigations_created || 0).toLocaleString()} investigations, ${Number(metrics.case_notes_added || 0).toLocaleString()} case notes, ${Number(metrics.approvals_requested || 0).toLocaleString()} approval requests, and ${Number(metrics.failures || 0).toLocaleString()} failures.`,
        } }));
      }
      await load();
    } catch (error) {
      setActions(current => ({ ...current, [kind]:{ tone:'danger', text:error.message || 'The internal operation could not be started.' } }));
    } finally {
      setRunning(current => ({ ...current, [kind]:false }));
    }
  }

  if (loading && !snapshot.dependencies && !snapshot.runtime) {
    return <div className="module-page"><div className="module-notice"><RefreshCw className="animate-spin" />Loading AI configuration…</div></div>;
  }

  const hermes = snapshot.dependencies?.services?.hermes || {};
  const runtime = snapshot.runtime?.ai_provider || {};
  const agent = snapshot.agent || {};
  const triage = drafts.triage;
  const correlation = drafts.correlation;
  const workflow = drafts.workflow;

  return (
    <div className="module-page space-y-4">
      <div className="module-hero compact">
        <div>
          <span className="eyebrow"><Bot />Evidence-grounded AI</span>
          <h2>AI Configuration</h2>
          <p>Read-only Hermes runtime facts and bounded policies for internal SOC analysis.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => load()} disabled={refreshing || savingRef.current}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh runtime state
        </button>
      </div>

      {loadError && <div className="module-notice danger" role="alert"><AlertTriangle />{loadError} Previously loaded values remain visible where available.</div>}

      <Panel icon={ShieldCheck} title="Hermes runtime" subtitle="Observed health and masked deployment configuration"
        action={<StatusBadge tone={healthTone(hermes.status)}>{hermes.status || 'unknown'}</StatusBadge>}>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span>Runtime values are read-only on this page.</span>
          {lastUpdated && <span>Last checked {fmtTs(lastUpdated)}</span>}
          {hermes.error_code && <StatusBadge tone="critical">{hermes.error_code}</StatusBadge>}
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Provider" value={runtime.provider || 'Hermes'} detail="Deployment-managed provider" />
          <Fact label="Model" value={runtime.model || hermes.model || 'Not reported'} detail={`${Number(hermes.advertised_models || 0).toLocaleString()} model${Number(hermes.advertised_models || 0) === 1 ? '' : 's'} advertised`} />
          <Fact label="Credential" value={runtime.credential_configured ? 'Configured' : 'Not configured'} detail="The credential value is never returned to the browser." />
          <Fact label="Safety profile" value={hermes.safe ? 'Verified' : 'Not verified'} detail={`${booleanFact(runtime.safe_toolsets_enforced)} safe-toolset enforcement`} />
          <Fact label="Capability checks" value={booleanFact(runtime.strict_capabilities)} detail="Required run capabilities are verified before use." />
          <Fact label="Host tool profile" value={runtime.tool_less_profile_required ? 'Tool-less required' : 'Not required'} detail={`${Number(hermes.active_toolsets?.length || 0).toLocaleString()} active host toolsets`} />
          <Fact label="Application tools" value={Number(hermes.application_tool_count || 0).toLocaleString()} detail={readable(hermes.application_tool_mode || 'not reported')} />
          <Fact label="Timeouts" value={`${Number(runtime.request_timeout_ms || 0).toLocaleString()} ms request`} detail={`${fmtDuration(Number(runtime.run_timeout_ms) || 0)} maximum run time`} />
        </dl>
        {hermes.error && <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200" role="alert">{hermes.error}</div>}
      </Panel>

      <Panel icon={Sparkles} title="Triage policy" subtitle="How enriched alerts are submitted for bounded evidence review"
        action={<StatusBadge tone={triage.triage_enabled === 'true' ? 'success' : 'neutral'}>{triage.triage_enabled === 'true' ? 'Enabled' : 'Disabled'}</StatusBadge>}>
        <PolicyRow label="AI triage" hint="When disabled, collection and enrichment continue without starting triage model runs.">
          <Toggle label="AI triage" checked={triage.triage_enabled === 'true'} disabled={saving.triage} onChange={value => update('triage', 'triage_enabled', value ? 'true' : 'false')} />
        </PolicyRow>
        <PolicyRow label="Review mode" hint="Controls whether every alert receives one bounded pass or qualifying evidence receives deeper review.">
          <select className="select w-full md:w-72" value={triage.triage_mode} disabled={saving.triage} onChange={event => update('triage', 'triage_mode', event.target.value)}>
            <option value="pipeline">Bounded single pass</option>
            <option value="hybrid">Conditional deeper review</option>
            <option value="agentic">Iterative review for every eligible alert</option>
          </select>
        </PolicyRow>
        <PolicyRow label="Token budget per cycle" hint="No new triage run starts after this cycle budget is reached; remaining alerts stay pending.">
          <NumberControl value={triage.triage_token_budget} min={10000} max={500000} step={5000} suffix="tokens" disabled={saving.triage} onChange={value => update('triage', 'triage_token_budget', value)} />
        </PolicyRow>
        <PolicyRow label="Maximum review iterations" hint="Hard bound for iterative evidence review.">
          <NumberControl value={triage.agentic_max_iterations} min={2} max={4} disabled={saving.triage} onChange={value => update('triage', 'agentic_max_iterations', value)} />
        </PolicyRow>
        {triage.triage_mode === 'hybrid' && <>
          <PolicyRow label="Deeper-review rule level" hint="Minimum alert rule level eligible for conditional deeper review.">
            <NumberControl value={triage.hybrid_agentic_min_rule_level} min={1} max={20} disabled={saving.triage} onChange={value => update('triage', 'hybrid_agentic_min_rule_level', value)} />
          </PolicyRow>
          <PolicyRow label="Deeper-review confidence" hint="A screening confidence below this value is eligible for additional evidence review.">
            <NumberControl value={triage.hybrid_agentic_confidence_below} min={0} max={1} step={0.01} disabled={saving.triage} onChange={value => update('triage', 'hybrid_agentic_confidence_below', value)} />
          </PolicyRow>
        </>}
        <PolicyRow label="Triage cache" hint="Reuses a verdict only when the alert and evidence contract are unchanged.">
          <span className="flex items-center gap-3"><Toggle label="Triage cache" checked={triage.caching_enabled === 'true'} disabled={saving.triage} onChange={value => update('triage', 'caching_enabled', value ? 'true' : 'false')} /><small className="text-xs text-[var(--muted)]">{triage.caching_enabled === 'true' ? 'Enabled' : 'Disabled'}</small></span>
        </PolicyRow>
        <PolicyRow label="Cache lifetime" hint="Expired entries are not reused, although physical cleanup is managed separately.">
          <NumberControl value={triage.triage_cache_ttl_hours} min={1} max={720} suffix="hours" disabled={saving.triage} onChange={value => update('triage', 'triage_cache_ttl_hours', value)} />
        </PolicyRow>
        <SaveBar dirty={dirty.triage} saving={saving.triage} onSave={() => saveSection('triage')} />
        <Feedback value={feedback.triage} />
      </Panel>

      <Panel icon={GitMerge} title="Correlation policy" subtitle="Evidence and resource bounds for grouping related triaged alerts"
        action={<StatusBadge tone={correlation.correlation_enabled === 'true' ? 'success' : 'neutral'}>{correlation.correlation_enabled === 'true' ? 'Enabled' : 'Disabled'}</StatusBadge>}>
        <PolicyRow label="Scheduled correlation" hint="Evaluates newly triaged alerts only after deterministic entity and time checks.">
          <Toggle label="Scheduled correlation" checked={correlation.correlation_enabled === 'true'} disabled={saving.correlation} onChange={value => update('correlation', 'correlation_enabled', value ? 'true' : 'false')} />
        </PolicyRow>
        <PolicyRow label="Look-back window" hint="Maximum age of triaged evidence included as context.">
          <NumberControl value={correlation.correlation_lookback_hours} min={1} max={168} suffix="hours" disabled={saving.correlation} onChange={value => update('correlation', 'correlation_lookback_hours', value)} />
        </PolicyRow>
        <PolicyRow label="Entity-link window" hint="Maximum time between connected alerts in one proposed incident chain.">
          <NumberControl value={correlation.correlation_entity_window_hours} min={1} max={48} suffix="hours" disabled={saving.correlation} onChange={value => update('correlation', 'correlation_entity_window_hours', value)} />
        </PolicyRow>
        <PolicyRow label="Candidate cap" hint="Hard limit on alerts supplied to one correlation run.">
          <NumberControl value={correlation.correlation_max_alerts} min={2} max={80} suffix="alerts" disabled={saving.correlation} onChange={value => update('correlation', 'correlation_max_alerts', value)} />
        </PolicyRow>
        <PolicyRow label="Token budget" hint="Bounds the correlation candidate batch before a model run begins.">
          <NumberControl value={correlation.correlation_token_budget} min={6000} max={100000} step={1000} suffix="tokens" disabled={saving.correlation} onChange={value => update('correlation', 'correlation_token_budget', value)} />
        </PolicyRow>
        <SaveBar dirty={dirty.correlation} saving={saving.correlation} onSave={() => saveSection('correlation')} />
        <Feedback value={feedback.correlation} />
        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-5 text-cyan-100">Runs correlation against existing BMB triage evidence. It can create or update internal incident records and does not modify Elastic.</p>
          <button type="button" className="btn-secondary whitespace-nowrap" disabled={running.correlation} onClick={() => runInternal('correlation')}>
            {running.correlation ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running.correlation ? 'Running…' : 'Run internal correlation'}
          </button>
        </div>
        <Feedback value={actions.correlation} />
      </Panel>

      <Panel icon={Workflow} title="Analyst-guided workflow policy" subtitle="Internal investigations, notes, assignments, and approval proposals"
        action={<StatusBadge tone={workflow.autonomous_agent_enabled === 'true' ? 'success' : 'neutral'}>{workflow.autonomous_agent_enabled === 'true' ? 'Enabled' : 'Disabled'}</StatusBadge>}>
        <div className="mb-2 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] p-3 text-xs leading-5 text-violet-100">
          This workflow can create BMB investigations and notes or submit approval requests. It does not directly isolate endpoints, suspend identities, block addresses, or change an external security platform.
        </div>
        <PolicyRow label="Workflow assistance" hint="Runs after configured collection, enrichment, triage, and correlation work.">
          <Toggle label="Workflow assistance" checked={workflow.autonomous_agent_enabled === 'true'} disabled={saving.workflow} onChange={value => update('workflow', 'autonomous_agent_enabled', value ? 'true' : 'false')} />
        </PolicyRow>
        <PolicyRow label="Evidence look-back" hint="Maximum age of qualifying triage and correlation evidence.">
          <NumberControl value={workflow.autonomous_lookback_hours} min={1} max={168} suffix="hours" disabled={saving.workflow} onChange={value => update('workflow', 'autonomous_lookback_hours', value)} />
        </PolicyRow>
        <PolicyRow label="Minimum confidence" hint="Only high-impact evidence at or above this threshold is considered.">
          <NumberControl value={workflow.autonomous_min_confidence} min={0} max={1} step={0.05} disabled={saving.workflow} onChange={value => update('workflow', 'autonomous_min_confidence', value)} />
        </PolicyRow>
        <PolicyRow label="Maximum work items" hint="Bounds the internal investigations considered during one run.">
          <NumberControl value={workflow.autonomous_max_items} min={1} max={100} suffix="items" disabled={saving.workflow} onChange={value => update('workflow', 'autonomous_max_items', value)} />
        </PolicyRow>
        <PolicyRow label="Propose case assignment" hint="Creates a pending approval instead of assigning an owner directly.">
          <Toggle label="Propose case assignment" checked={workflow.autonomous_assignment_enabled === 'true'} disabled={saving.workflow} onChange={value => update('workflow', 'autonomous_assignment_enabled', value ? 'true' : 'false')} />
        </PolicyRow>
        <PolicyRow label="Proposed owner" hint="Queue or analyst named in an assignment proposal.">
          <input className="input h-9 w-full md:w-72" maxLength="120" value={workflow.autonomous_default_owner} disabled={saving.workflow} onChange={event => update('workflow', 'autonomous_default_owner', event.target.value)} />
        </PolicyRow>
        <PolicyRow label="Propose response simulations" hint="Creates approval requests for reversible BMB-only simulations; no external connector is invoked.">
          <Toggle label="Propose response simulations" checked={workflow.simulated_response_proposals_enabled === 'true'} disabled={saving.workflow} onChange={value => update('workflow', 'simulated_response_proposals_enabled', value ? 'true' : 'false')} />
        </PolicyRow>
        <SaveBar dirty={dirty.workflow} saving={saving.workflow} onSave={() => saveSection('workflow')} />
        <Feedback value={feedback.workflow} />
        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-5 text-cyan-100">Runs an internal review immediately using the saved workflow policy. Unsaved fields on this page are not used.</p>
          <button type="button" className="btn-secondary whitespace-nowrap" disabled={running.workflow} onClick={() => runInternal('workflow')}>
            {running.workflow ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running.workflow ? 'Running…' : 'Run internal workflow review'}
          </button>
        </div>
        <Feedback value={actions.workflow} />
      </Panel>

      <Panel icon={Activity} title="Internal workflow status" subtitle="Recent persisted workflow activity"
        action={<StatusBadge tone={healthTone(agent.latest_run?.status)}>{agent.latest_run?.status || (agent.enabled ? 'ready' : 'disabled')}</StatusBadge>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Policy version" value={agent.policy_version || 'Not reported'} />
          <Fact label="Pending approvals" value={Number(agent.pending_approvals || 0).toLocaleString()} />
          <Fact label="Latest run" value={agent.latest_run?.status ? readable(agent.latest_run.status) : 'No run recorded'} detail={agent.latest_run?.started_at ? fmtTs(agent.latest_run.started_at) : null} />
          <Fact label="Latest duration" value={fmtDuration(Number(agent.latest_run?.metrics?.duration_ms || 0))} detail={agent.latest_run?.trigger ? `Trigger: ${readable(agent.latest_run.trigger)}` : null} />
        </div>
        <div className="mt-4 space-y-2">
          {(agent.recent_operations || []).slice(0, 6).map(operation => (
            <article key={operation.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-3 sm:flex-row sm:items-center">
              <StatusBadge tone={healthTone(operation.status)}>{readable(operation.status)}</StatusBadge>
              <div className="min-w-0 flex-1"><strong className="block truncate text-sm text-[var(--text)]">{readable(operation.operation_type)}</strong><small className="mt-0.5 block truncate text-xs text-[var(--muted)]">{operation.target_type && operation.target_id ? `${readable(operation.target_type)} ${operation.target_id}` : operation.reason || 'Internal workflow operation'}</small></div>
              <time className="text-xs text-[var(--muted)]">{fmtTs(operation.updated_at || operation.started_at)}</time>
            </article>
          ))}
          {!agent.recent_operations?.length && <p className="py-6 text-center text-sm text-[var(--muted)]">No internal workflow operations have been recorded.</p>}
        </div>
      </Panel>
    </div>
  );
}
