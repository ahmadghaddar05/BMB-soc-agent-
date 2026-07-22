import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, Database, Play, RefreshCw,
  RotateCcw, Save, Server, ShieldCheck, TimerReset,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api, fmtDuration, fmtTs } from '../lib/api';

const EMPTY_DRAFT = Object.freeze({
  scheduler_enabled: 'false',
  interval_minutes: '5',
  lookback_minutes: '15',
  min_level: '7',
  limit: '200',
  elastic_lookback_minutes: '43200',
  elastic_min_risk_score: '48',
  elastic_limit: '100',
});

function schedulerDraft(settings = {}) {
  return {
    scheduler_enabled: settings.scheduler_enabled ?? EMPTY_DRAFT.scheduler_enabled,
    interval_minutes: settings.interval_minutes ?? EMPTY_DRAFT.interval_minutes,
    lookback_minutes: settings.lookback_minutes ?? EMPTY_DRAFT.lookback_minutes,
    min_level: settings.min_level ?? EMPTY_DRAFT.min_level,
    limit: settings.limit ?? EMPTY_DRAFT.limit,
    elastic_lookback_minutes: settings.elastic_lookback_minutes ?? EMPTY_DRAFT.elastic_lookback_minutes,
    elastic_min_risk_score: settings.elastic_min_risk_score ?? EMPTY_DRAFT.elastic_min_risk_score,
    elastic_limit: settings.elastic_limit ?? EMPTY_DRAFT.elastic_limit,
  };
}

function wholeNumber(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return `${label} must be a whole number between ${min.toLocaleString()} and ${max.toLocaleString()}.`;
  }
  return null;
}

function validateDraft(draft, source) {
  const common = wholeNumber(draft.interval_minutes, 1, 1440, 'Poll interval');
  if (common) return common;
  if (source === 'elastic') {
    return wholeNumber(draft.elastic_lookback_minutes, 1, 525600, 'Elastic look-back window')
      || wholeNumber(draft.elastic_min_risk_score, 0, 100, 'Minimum Elastic risk score')
      || wholeNumber(draft.elastic_limit, 1, 5000, 'Elastic alert limit');
  }
  return wholeNumber(draft.lookback_minutes, 1, 10080, 'Wazuh look-back window')
    || wholeNumber(draft.min_level, 0, 20, 'Minimum Wazuh rule level')
    || wholeNumber(draft.limit, 1, 5000, 'Wazuh alert limit');
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '—';
}

function age(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unavailable';
  const difference = Date.now() - timestamp;
  const future = difference < 0;
  const absolute = Math.abs(difference);
  const minutes = Math.floor(absolute / 60000);
  const text = minutes < 1 ? 'less than a minute'
    : minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'}`
      : minutes < 1440 ? `${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) === 1 ? '' : 's'}`
        : `${Math.floor(minutes / 1440)} day${Math.floor(minutes / 1440) === 1 ? '' : 's'}`;
  return future ? `${text} ahead of this browser` : `${text} ago`;
}

function runTone(status) {
  if (status === 'ok' || status === 'completed') return 'success';
  if (status === 'running') return 'attention';
  if (status === 'error' || status === 'failed' || status === 'partial') return 'critical';
  return 'neutral';
}

function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-blue-500' : 'bg-slate-700'}`}
    >
      <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function Panel({ icon: Icon, title, subtitle, action, children }) {
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

function Metric({ label, value, detail, tone = 'default' }) {
  const toneClass = tone === 'good' ? 'text-emerald-300'
    : tone === 'warning' ? 'text-amber-300'
      : tone === 'danger' ? 'text-rose-300' : 'text-[var(--text)]';
  return (
    <article className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</span>
      <strong className={`mt-2 block break-words text-xl font-semibold ${toneClass}`}>{value}</strong>
      {detail && <small className="mt-1 block text-xs leading-5 text-[var(--muted)]">{detail}</small>}
    </article>
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

function RunTable({ runs }) {
  if (!runs.length) return <p className="py-6 text-center text-sm text-[var(--muted)]">No collection cycles have been recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead><tr className="border-b border-[var(--border-soft)]">
          {['Run', 'Started', 'Trigger', 'Fetched', 'Stored', 'Duplicates', 'Triaged', 'Duration', 'Status'].map(label => <th key={label} className="th">{label}</th>)}
        </tr></thead>
        <tbody>{runs.map(run => (
          <tr key={run.id} className="table-row">
            <td className="td font-mono text-xs text-[var(--muted)]">#{run.id}</td>
            <td className="td whitespace-nowrap text-xs">{fmtTs(run.started_at)}</td>
            <td className="td capitalize">{run.trigger || '—'}</td>
            <td className="td">{count(run.fetched)}</td>
            <td className="td">{count(run.stored)}</td>
            <td className="td">{count(run.duplicates)}</td>
            <td className="td">{count(run.triaged)}</td>
            <td className="td whitespace-nowrap">{fmtDuration(Number(run.duration_ms) || 0)}</td>
            <td className="td"><StatusBadge tone={runTone(run.status)}>{run.status || 'unknown'}</StatusBadge></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function CollectorHealth() {
  const [snapshot, setSnapshot] = useState({ collector:null, scheduler:null, settings:null, stats:null });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [running, setRunning] = useState(false);
  const [runFeedback, setRunFeedback] = useState(null);
  const dirtyRef = useRef(false);
  const requestRef = useRef(null);
  const savingRef = useRef(false);

  const load = useCallback(async ({ initial = false, forceDraft = false } = {}) => {
    if (savingRef.current && !forceDraft) return;
    requestRef.current?.abort();
    const controller = new window.AbortController();
    requestRef.current = controller;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const results = await Promise.allSettled([
        api('/collector/status', { signal:controller.signal }),
        api('/scheduler/status', { signal:controller.signal }),
        api('/settings', { signal:controller.signal }),
      ]);
      if (requestRef.current !== controller) return;
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length === results.length) throw failures[0].reason;

      const collector = results[0].status === 'fulfilled' ? results[0].value : null;
      const scheduler = results[1].status === 'fulfilled' ? results[1].value : null;
      const settingsResponse = results[2].status === 'fulfilled' ? results[2].value : null;
      setSnapshot(current => ({
        collector: collector ?? current.collector,
        scheduler: scheduler ?? current.scheduler,
        settings: settingsResponse?.settings ?? current.settings,
        stats: settingsResponse?.stats ?? current.stats,
      }));
      if (settingsResponse?.settings && (forceDraft || !dirtyRef.current)) {
        setDraft(schedulerDraft(settingsResponse.settings));
        dirtyRef.current = false;
        setDirty(false);
      }
      const messages = failures.map(result => result.reason?.message || 'A status endpoint did not respond.');
      setLoadError(messages.join(' '));
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      if (error?.name !== 'AbortError') setLoadError(error?.message || 'Collector status could not be loaded.');
    } finally {
      if (requestRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load({ initial:true, forceDraft:true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = setInterval(refreshWhenVisible, 15000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      requestRef.current?.abort();
    };
  }, [load]);

  function updateDraft(key, value) {
    dirtyRef.current = true;
    setDirty(true);
    setSaveFeedback(null);
    setDraft(current => ({ ...current, [key]:value }));
  }

  function discardDraft() {
    setDraft(schedulerDraft(snapshot.settings || {}));
    dirtyRef.current = false;
    setDirty(false);
    setSaveFeedback(null);
  }

  async function saveScheduler(event) {
    event.preventDefault();
    const validation = validateDraft(draft, source);
    if (validation) {
      setSaveFeedback({ tone:'danger', text:validation });
      return;
    }
    requestRef.current?.abort();
    savingRef.current = true;
    setSaving(true);
    setSaveFeedback(null);
    try {
      const sourceSettings = source === 'elastic'
        ? ['elastic_lookback_minutes', 'elastic_min_risk_score', 'elastic_limit']
        : ['lookback_minutes', 'min_level', 'limit'];
      const payload = Object.fromEntries(['scheduler_enabled', 'interval_minutes', ...sourceSettings].map(key => [key, draft[key]]));
      const response = await api('/settings', { method:'PUT', body:JSON.stringify(payload) });
      const settings = response.settings || { ...(snapshot.settings || {}), ...draft };
      setSnapshot(current => ({ ...current, settings }));
      setDraft(schedulerDraft(settings));
      dirtyRef.current = false;
      setDirty(false);
      setSaveFeedback({ tone:'success', text:'Scheduler policy saved. The observed runtime state will update separately.' });
    } catch (error) {
      setSaveFeedback({ tone:'danger', text:error.message || 'Scheduler policy could not be saved.' });
    } finally {
      savingRef.current = false;
      setSaving(false);
      load();
    }
  }

  async function runCycle() {
    setRunning(true);
    setRunFeedback(null);
    try {
      const result = await api('/scheduler/run-now', { method:'POST', body:'{}' });
      if (result.error) {
        setRunFeedback({ tone:'danger', text:`Collection cycle failed: ${result.error}` });
      } else if (result.skipped) {
        setRunFeedback({ tone:'danger', text:'A collection cycle is already in progress, so this request was not started.' });
      } else {
        const stats = result.stats || {};
        setRunFeedback({
          tone:'success',
          text:`Cycle completed: ${count(stats.fetched)} fetched, ${count(stats.stored)} stored, ${count(stats.duplicates)} duplicates, and ${count(stats.triaged)} triaged.`,
        });
      }
      await load();
    } catch (error) {
      setRunFeedback({ tone:'danger', text:error.message || 'The collection cycle could not be started.' });
    } finally {
      setRunning(false);
    }
  }

  const collectorResponse = snapshot.collector || {};
  const collector = collectorResponse.collector || {};
  const database = collectorResponse.database || {};
  const runtime = collectorResponse.runtime || {};
  const scheduler = snapshot.scheduler || {};
  const latest = collectorResponse.latest_run || scheduler.recent_runs?.[0] || null;
  const recentRuns = scheduler.recent_runs || [];
  const source = collector.source || 'unknown';
  const cycleActive = Boolean(collector.cycle_active || scheduler.cycle_active);
  const schedulerRunning = Boolean(collector.scheduler_running || scheduler.running);
  const cursorState = source !== 'elastic' ? 'Not applicable'
    : !collector.cursor_enabled ? 'Disabled'
      : collector.cursor_timestamp ? fmtTs(collector.cursor_timestamp) : 'Not initialized';
  const cursorDetail = collector.cursor_timestamp
    ? `${age(collector.cursor_timestamp)} · age of the last acknowledged Elastic sort cursor, not source-to-dashboard latency`
    : collector.cursor_enabled ? 'No cursor has been committed yet.' : 'Cursor collection is not enabled.';

  if (loading && !snapshot.collector && !snapshot.scheduler) {
    return <div className="module-page"><div className="module-notice"><RefreshCw className="animate-spin" />Loading collector state…</div></div>;
  }

  return (
    <div className="module-page space-y-4">
      <div className="module-hero compact">
        <div>
          <span className="eyebrow"><Activity />Collection operations</span>
          <h2>Collector Health</h2>
          <p>Observed ingestion state, cursor position, collection history, and scheduler policy.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => load()} disabled={refreshing || saving}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh observed state
        </button>
      </div>

      {loadError && <div className="module-notice danger" role="alert"><AlertTriangle />{loadError} Previously loaded values remain visible where available.</div>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
        <StatusBadge tone={cycleActive ? 'attention' : schedulerRunning ? 'success' : 'neutral'}>
          {cycleActive ? 'Cycle running' : schedulerRunning ? 'Scheduler running' : 'Scheduler stopped'}
        </StatusBadge>
        <span>Source: <strong className="text-[var(--text)]">{source}</strong></span>
        {lastUpdated && <span>Observed {age(lastUpdated)}</span>}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Collector summary">
        <Metric label="Collection freshness" value={latest?.finished_at ? age(latest.finished_at) : 'No completed run'} detail={latest?.finished_at ? `Last completed ${fmtTs(latest.finished_at)}` : 'No successful completion timestamp is available.'} tone={latest?.status === 'ok' ? 'good' : 'warning'} />
        <Metric label="Elastic cursor" value={cursorState} detail={cursorDetail} tone={collector.cursor_enabled ? 'default' : 'warning'} />
        <Metric label="Stored Elastic alerts" value={count(database.elastic_alerts)} detail={`${count(database.grouped_activities)} grouped activities`} />
        <Metric label="Per-cycle ceiling" value={count(collector.max_alerts_per_cycle)} detail={`${count(collector.page_size)} records × ${count(collector.max_pages)} pages`} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]">
        <Panel icon={Server} title="Latest collection cycle" subtitle="Persisted fetch-run evidence, not a browser estimate" action={latest?.status && <StatusBadge tone={runTone(latest.status)}>{latest.status}</StatusBadge>}>
          {latest ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Run', `#${latest.id ?? '—'}`], ['Started', fmtTs(latest.started_at)],
                  ['Finished', fmtTs(latest.finished_at)], ['Trigger', latest.trigger || '—'],
                  ['Fetched', count(latest.fetched)], ['Stored', count(latest.stored)],
                  ['Duplicates', count(latest.duplicates)], ['Enriched', count(latest.enriched)],
                  ['Enrichment failures', count(latest.enrichment_failed)], ['Triaged', count(latest.triaged)],
                  ['Triage failures', count(latest.triage_failed)], ['Duration', fmtDuration(Number(latest.duration_ms) || 0)],
                ].map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--surface-2)] p-3"><dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[var(--text)]">{value}</dd></div>)}
              </dl>
              {(latest.error || runtime.last_error || scheduler.last_error) && <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200" role="alert">{latest.error || runtime.last_error || scheduler.last_error}</div>}
            </>
          ) : <p className="py-8 text-center text-sm text-[var(--muted)]">No collection run has been recorded.</p>}
          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-xs leading-5 text-[var(--muted)]">Runs the internal collection pipeline with the currently saved policy. It can perform configured enrichment, triage, correlation, and internal workflow processing.</p>
            <button type="button" className="btn-primary whitespace-nowrap" onClick={runCycle} disabled={running || cycleActive}>
              {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? 'Running cycle…' : cycleActive ? 'Cycle already running' : 'Run collection cycle'}
            </button>
          </div>
          <Feedback value={runFeedback} />
        </Panel>

        <Panel icon={Database} title="Stored pipeline state" subtitle="Current BMB evidence-store counts">
          <dl className="space-y-1">
            {[
              ['Grouped activities', count(database.grouped_activities)],
              ['Missing group keys', count(database.missing_group_keys)],
              ['Awaiting enrichment', count(database.enrichment_pending)],
              ['Enrichment failures', count(database.enrichment_failed)],
              ['Enrichment batch size', count(collector.enrichment_batch_size)],
            ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] py-2.5 last:border-0"><dt className="text-sm text-[var(--muted)]">{label}</dt><dd className="font-semibold text-[var(--text)]">{value}</dd></div>)}
          </dl>
          <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-3 text-xs leading-5 text-cyan-100">
            <ShieldCheck className="mr-2 inline h-4 w-4" />
            Elastic write-back is {collectorResponse.safety?.elastic_writeback_enabled ? 'enabled by stored policy' : 'disabled'}. This page does not change Elastic records.
          </div>
        </Panel>
      </div>

      <Panel icon={TimerReset} title="Scheduler policy" subtitle="Editable collection cadence and limits">
        <form onSubmit={saveScheduler}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="flex min-h-[76px] items-center justify-between gap-4 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
              <span><strong className="block text-sm text-[var(--text)]">Scheduled collection</strong><small className="mt-1 block text-xs text-[var(--muted)]">Starts the configured recurring job.</small></span>
              <Toggle label="Scheduled collection" checked={draft.scheduler_enabled === 'true'} disabled={saving} onChange={value => updateDraft('scheduler_enabled', value ? 'true' : 'false')} />
            </label>
            {(source === 'elastic' ? [
              ['interval_minutes', 'Poll interval', 'minutes', 1, 1440],
              ['elastic_lookback_minutes', 'Elastic look-back', 'minutes', 1, 525600],
              ['elastic_min_risk_score', 'Minimum risk score', '0-100', 0, 100],
              ['elastic_limit', 'Elastic alert limit', 'per cycle', 1, 5000],
            ] : [
              ['interval_minutes', 'Poll interval', 'minutes', 1, 1440],
              ['lookback_minutes', 'Look-back window', 'minutes', 1, 10080],
              ['min_level', 'Minimum rule level', '0–20', 0, 20],
              ['limit', 'Alert limit', 'per cycle', 1, 5000],
            ]).map(([key, label, suffix, min, max]) => (
              <label key={key} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
                <span className="block text-xs font-semibold text-[var(--text)]">{label}</span>
                <span className="mt-2 flex items-center gap-2">
                  <input className="input h-9" type="number" min={min} max={max} value={draft[key]} disabled={saving} onChange={event => updateDraft(key, event.target.value)} />
                  <small className="whitespace-nowrap text-[11px] text-[var(--muted)]">{suffix}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-[var(--muted)]">Observed runtime values continue refreshing every 15 seconds while this tab is visible. Unsaved fields are preserved.</p>
            <div className="flex gap-2">
              {dirty && <button type="button" className="btn-secondary" onClick={discardDraft} disabled={saving}><RotateCcw className="h-4 w-4" />Discard changes</button>}
              <button type="submit" className="btn-primary" disabled={!dirty || saving}>
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Save scheduler policy'}
              </button>
            </div>
          </div>
          <Feedback value={saveFeedback} />
        </form>
      </Panel>

      <Panel icon={Clock3} title="Recent collection cycles" subtitle={`${recentRuns.length} most recent runs returned by the scheduler`}>
        <RunTable runs={recentRuns} />
      </Panel>
    </div>
  );
}
