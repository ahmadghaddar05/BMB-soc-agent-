import { useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle, BriefcaseBusiness, Building2, CheckCircle2, Clock3,
  RefreshCw, ShieldCheck, UserRound, Workflow, X,
} from 'lucide-react';
import { humanize } from '../../lib/executive';
import { relativeTime } from '../../lib/soc';

function impactTone(value) {
  const impact = String(value || '').toLowerCase();
  if (impact === 'critical' || impact === 'high') {
    return 'border-[#ff5c6c]/40 bg-[#ff5c6c]/10 text-[#ff7a87]';
  }
  if (impact === 'medium') return 'border-[#f2c94c]/40 bg-[#f2c94c]/10 text-[#f4d267]';
  return 'border-[#3979a7] bg-[#183248]/60 text-[#91bddb]';
}

function impactOf(data = {}) {
  return data.business_impact || data.severity || 'unknown';
}

function drawerCopy(state) {
  const { selection, data = {} } = state;
  if (!selection) return { eyebrow:'Executive review', title:'Security decision brief' };
  if (selection.type === 'risk-summary') {
    return { eyebrow:'Leadership risk register', title:'Risks requiring attention' };
  }
  if (selection.type === 'incident') {
    return { eyebrow:'Business risk decision brief', title:data.title || `Incident ${selection.id}` };
  }
  if (selection.type === 'asset') {
    return { eyebrow:'Observed technology exposure', title:data.name || 'Technology exposure' };
  }
  return { eyebrow:'Metric transparency', title:data.title || 'Metric definition' };
}

function riskSummary(data = {}) {
  const risks = data.risks || [];
  const total = Number(data.total || risks.length || 0);
  const critical = risks.filter(item => item.severity === 'critical').length;
  const unassigned = risks.filter(item => !item.owner).length;
  if (!total) return 'No open security risks were returned for the current executive view.';
  return `${total} open risk${total === 1 ? '' : 's'} require security-team ownership. ${critical} ${critical === 1 ? 'is' : 'are'} critical and ${unassigned} ${unassigned === 1 ? 'has' : 'have'} no recorded owner.`;
}

function MetricBrief({ data }) {
  const methodology = data.overview?.health?.methodology;
  const timeSaved = data.overview?.time_saved;
  const isWorkload = data.id === 'workload-reduction' || data.title?.toLowerCase().includes('workload');
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#223d52] bg-[#0b1824] p-5">
        <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#7ea8c4]">What this means</p>
        <p className="mt-3 text-[15px] leading-7 text-[#c6d5df]">{data.summary || 'This metric is calculated only from stored evidence and explicitly identified assumptions.'}</p>
      </section>
      {isWorkload && timeSaved && (
        <section className="rounded-2xl border border-[#3e3568] bg-[#11172a] p-5">
          <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#aa97ff]">Estimated value calculation</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <article className="rounded-xl bg-[#0a1522] p-3"><span className="text-xs text-[#718a9e]">Estimated hours</span><strong className="mt-1 block text-xl text-white">{Number(timeSaved.hours || 0).toFixed(1)}h</strong></article>
            <article className="rounded-xl bg-[#0a1522] p-3"><span className="text-xs text-[#718a9e]">Reporting period</span><strong className="mt-1 block text-xl text-white">{timeSaved.period_days || 30} days</strong></article>
          </div>
          <dl className="mt-4 space-y-2 text-xs text-[#8da4b7]">
            <div className="flex justify-between gap-4"><dt>AI-triaged activities</dt><dd>{Number(timeSaved.inputs?.triaged_activities || 0).toLocaleString()}</dd></div>
            <div className="flex justify-between gap-4"><dt>Assumed minutes per triage</dt><dd>{timeSaved.assumptions_minutes?.triage_per_activity ?? 'Unavailable'}</dd></div>
            <div className="flex justify-between gap-4"><dt>Correlated incidents</dt><dd>{Number(timeSaved.inputs?.correlated_incidents || 0).toLocaleString()}</dd></div>
            <div className="flex justify-between gap-4"><dt>Assumed minutes per correlation</dt><dd>{timeSaved.assumptions_minutes?.correlation_per_incident ?? 'Unavailable'}</dd></div>
          </dl>
          <p className="mt-4 text-xs leading-5 text-[#718a9e]">This is an estimate, not measured ROI. Token use is not counted as human time and no external containment is included.</p>
        </section>
      )}
      {!isWorkload && methodology && (
        <section className="rounded-2xl border border-[#1d394d] bg-[#091722] p-5">
          <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#7ea8c4]">Calculation boundary</p>
          <p className="mt-3 text-sm leading-6 text-[#a9bdca]">{methodology.description}</p>
          <p className="mt-3 text-xs leading-5 text-[#718a9e]">The score is derived and should be interpreted with the source-coverage status shown on the overview.</p>
        </section>
      )}
    </div>
  );
}

function RiskDirectory({ data, onOpen }) {
  const risks = data.risks || [];
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#223d52] bg-[#0b1824] p-5">
        <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#7ea8c4]">Leadership summary</p>
        <p className="mt-3 text-[15px] leading-7 text-[#c6d5df]">{riskSummary(data)}</p>
      </section>
      <section aria-labelledby="executive-risk-register">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="executive-risk-register" className="text-base font-semibold text-[#edf5fa]">Decision queue</h3>
          <span className="rounded-full bg-[#10283a] px-2.5 py-1 text-xs text-[#7fa5c0]">{Number(data.total || risks.length)} open</span>
        </div>
        <div className="space-y-2">
          {risks.length ? risks.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={event => onOpen?.({ type:'incident', id:item.id, seed:item }, event.currentTarget)}
              className="grid w-full gap-3 rounded-xl border border-[#1d394d] bg-[#091722] p-4 text-left transition hover:border-[#3a6482] hover:bg-[#0e202e] sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className="min-w-0">
                <strong className="block text-sm leading-5 text-[#e3edf3]">{item.title}</strong>
                <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#7891a5]">
                  <span><UserRound className="mr-1 inline h-3 w-3" />{item.owner || 'Owner required'}</span>
                  <span><Clock3 className="mr-1 inline h-3 w-3" />Last activity {relativeTime(item.last_seen)}</span>
                </span>
                <span className="mt-2 block text-xs font-medium text-[#a8bfd0]">{item.required_decision}</span>
              </span>
              <span className={`h-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${impactTone(impactOf(item))}`}>{humanize(impactOf(item))} priority</span>
            </button>
          )) : <div className="rounded-xl border border-dashed border-[#27445a] px-5 py-8 text-center text-sm text-[#718a9e]">No open risks are currently recorded.</div>}
        </div>
      </section>
    </div>
  );
}

function IncidentBrief({ data }) {
  const impact = impactOf(data);
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#223d52] bg-[#0b1824] p-5">
        <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#9b8afb]">AI-assisted executive interpretation</p>
        <p className="mt-3 text-[15px] leading-7 text-[#c6d5df]">{data.executive_summary || 'A leadership summary is not available for this incident.'}</p>
        <p className="mt-3 text-xs leading-5 text-[#758da0]">This summary contains business-level context only. The SOC team retains the underlying evidence and technical timeline.</p>
      </section>

      <section className="grid grid-cols-2 gap-3" aria-label="Executive incident facts">
        {[
          [BriefcaseBusiness, 'Business service', data.business_service || 'Not mapped'],
          [AlertTriangle, 'Business impact', `${humanize(impact)} — severity proxy`],
          [UserRound, 'Accountable owner', data.owner || 'Unassigned'],
          [ShieldCheck, 'Current status', humanize(data.status || 'Open')],
        ].map(([Icon, label, value]) => (
          <article key={label} className="rounded-xl border border-[#1c3549] bg-[#091722] p-4">
            <Icon className="mb-3 h-4 w-4 text-[#4c9aff]" />
            <span className="block text-[11px] font-semibold uppercase tracking-[.08em] text-[#607a8e]">{label}</span>
            <strong className="mt-1.5 block text-sm leading-5 text-[#d9e5ed]">{value}</strong>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-[#f2c94c]/25 bg-[#f2c94c]/[.05] p-5">
        <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#f4d267]">Decision required</p>
        <p className="mt-2 text-base font-semibold leading-6 text-[#f1e4b3]">{data.required_decision || 'Confirm ownership and next action.'}</p>
      </section>

      <section className="rounded-2xl border border-[#1d394d] bg-[#091722] p-5">
        <h3 className="text-sm font-semibold text-[#e3edf3]">Risk and assurance</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-start justify-between gap-6"><dt className="text-[#718a9e]">Impact basis</dt><dd className="max-w-[360px] text-right text-[#b9cad5]">{data.impact_basis || 'Stored incident severity'}</dd></div>
          <div className="flex items-start justify-between gap-6"><dt className="text-[#718a9e]">Containment</dt><dd className="max-w-[360px] text-right text-[#b9cad5]">{data.containment_status === 'not_recorded' ? 'No approved containment state is recorded' : humanize(data.containment_status)}</dd></div>
          <div className="flex items-start justify-between gap-6"><dt className="text-[#718a9e]">Evidence assurance</dt><dd className="max-w-[360px] text-right text-[#b9cad5]">{data.evidence_assurance || 'Supporting evidence is held by the SOC team'}</dd></div>
          <div className="flex items-start justify-between gap-6"><dt className="text-[#718a9e]">Last activity</dt><dd className="text-right text-[#b9cad5]">{relativeTime(data.last_seen)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function AssetBrief({ data }) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#223d52] bg-[#0b1824] p-5">
        <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#7ea8c4]">Why this category appears</p>
        <p className="mt-3 text-[15px] leading-7 text-[#c6d5df]">This technology category has one of the highest concentrations of observed high-risk security activity during the selected period.</p>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <article className="rounded-xl border border-[#1c3549] bg-[#091722] p-4"><Building2 className="mb-3 h-4 w-4 text-[#4c9aff]" /><span className="text-xs text-[#718a9e]">High-risk activities</span><strong className="mt-1 block text-2xl text-white">{Number(data.high_risk_activity_count || 0).toLocaleString()}</strong></article>
        <article className="rounded-xl border border-[#1c3549] bg-[#091722] p-4"><Clock3 className="mb-3 h-4 w-4 text-[#4c9aff]" /><span className="text-xs text-[#718a9e]">Last activity</span><strong className="mt-1 block text-sm text-white">{relativeTime(data.last_seen)}</strong></article>
      </section>
      <section className="rounded-2xl border border-[#f2c94c]/25 bg-[#f2c94c]/[.05] p-5">
        <p className="text-xs font-semibold uppercase tracking-[.1em] text-[#f4d267]">Interpretation limit</p>
        <p className="mt-2 text-sm leading-6 text-[#c8b77c]">This is a derived technology category, not a mapped business service. Business ownership and service criticality must be connected before leadership can treat it as quantified business exposure.</p>
      </section>
    </div>
  );
}

export default function DeepDiveDrawer({ state, onClose, onRetry, onOpen }) {
  const closeRef = useRef(null);
  const drawerRef = useRef(null);
  const isOpen = state.status !== 'closed';
  const copy = useMemo(() => drawerCopy(state), [state]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(drawerRef.current?.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const data = state.data || {};
  const impact = impactOf(data);

  return (
    <div className="fixed inset-0 z-[90]" aria-live="polite">
      <button type="button" className="absolute inset-0 cursor-default bg-[#01070c]/75 backdrop-blur-[2px]" onClick={onClose} aria-label="Close executive detail" />
      <aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="deep-dive-title" className="absolute inset-y-0 right-0 flex w-full max-w-[680px] flex-col border-l border-[#203b50] bg-[#07121c] shadow-[-24px_0_70px_rgba(0,0,0,.48)]">
        <header className="border-b border-[#1b3448] bg-[#091621]/95 px-5 py-5 backdrop-blur md:px-7">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#4c9aff]"><Workflow size={13} />{copy.eyebrow}</p>
              <h2 id="deep-dive-title" className="text-xl font-semibold leading-7 tracking-[-.02em] text-[#f3f7fb] md:text-2xl">{copy.title}</h2>
              {state.selection?.type === 'incident' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${impactTone(impact)}`}>{humanize(impact)} priority</span>
                  <span className="rounded-full border border-[#27445a] bg-[#0d1d2a] px-2.5 py-1 text-xs text-[#8da4b7]">Executive summary</span>
                </div>
              )}
            </div>
            <button ref={closeRef} type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#244159] text-[#8da4b7] transition hover:border-[#3f6c8e] hover:bg-[#102332] hover:text-white" aria-label="Close details"><X size={18} /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-7">
          {state.status === 'loading' && <div className="grid min-h-[320px] place-items-center"><div className="text-center text-[#8da4b7]"><RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-[#4c9aff]" /><strong className="block text-sm text-[#dce9f2]">Preparing executive summary</strong><span className="mt-1 block text-xs">Loading decision-level information only.</span></div></div>}
          {state.status === 'error' && <div className="rounded-xl border border-[#ff5c6c]/30 bg-[#ff5c6c]/[.06] p-5"><AlertTriangle className="mb-3 text-[#ff7280]" /><h3 className="font-semibold text-[#f3f7fb]">Summary could not be loaded</h3><p className="mt-2 text-sm leading-6 text-[#9d7d82]">{state.error}</p><button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#183d65] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#205080]"><RefreshCw size={15} />Try again</button></div>}
          {state.status === 'ready' && state.selection?.type === 'risk-summary' && <RiskDirectory data={data} onOpen={onOpen} />}
          {state.status === 'ready' && state.selection?.type === 'incident' && <IncidentBrief data={data} />}
          {state.status === 'ready' && state.selection?.type === 'asset' && <AssetBrief data={data} />}
          {state.status === 'ready' && state.selection?.type === 'metric' && <MetricBrief data={{ ...data, id:state.selection.id }} />}
        </div>

        <footer className="border-t border-[#1b3448] bg-[#091621] px-5 py-4 md:px-7">
          <div className="flex items-start gap-3 rounded-xl border border-[#1d394d] bg-[#0a1823] px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#43d5a2]" />
            <p className="text-xs leading-5 text-[#7891a5]"><strong className="text-[#b9ccd8]">Role-safe view.</strong> Raw logs, observables, technical identifiers, and response controls are intentionally restricted to SOC Analyst workspaces.</p>
          </div>
          <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl border border-[#315570] bg-[#10283a] px-4 py-3 text-sm font-semibold text-[#dceaf3] transition hover:bg-[#15364e]">Return to overview</button>
        </footer>
      </aside>
    </div>
  );
}
