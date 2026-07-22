import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, Bot, Building2, CalendarClock, CheckCircle2,
  ChevronRight, CircleDot, Clock3, RefreshCw, ShieldCheck, Workflow, X,
} from 'lucide-react';
import { fmtTs } from '../../lib/api';
import {
  activityTitle, affectedEntity, businessAssetLabel, businessAssetType,
  humanize, operationWin, severityOf, technicalLink,
} from '../../lib/executive';

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function incidentFromState(state) {
  if (state.selection?.type === 'incident') return state.data;
  if (state.selection?.type === 'automation') return state.data?.incident || null;
  return null;
}

function evidenceFromState(state) {
  const incident = incidentFromState(state);
  if (incident) return incident.alerts || [];
  if (state.selection?.type === 'asset') return state.data?.alerts || [];
  if (state.selection?.type === 'automation' && state.data?.alert) return [state.data.alert];
  if (state.selection?.type === 'risk-summary') return state.data?.incidents || [];
  if (state.selection?.type === 'metric') return state.data?.evidence || [];
  return [];
}

function drawerCopy(state) {
  const { selection, data } = state;
  if (!selection) return { title:'Security detail', eyebrow:'Executive deep dive', summary:'' };
  if (selection.type === 'risk-summary') {
    const total = Number(data?.total || data?.incidents?.length || 0);
    return {
      title:'Active business risks', eyebrow:'Potential business impact',
      summary: total
        ? `${total} open correlated incident${total === 1 ? '' : 's'} currently require security-team attention. Impact is estimated from evidence severity until business-service criticality is mapped.`
        : 'No open correlated incidents were returned for the current view.',
    };
  }
  if (selection.type === 'incident') {
    return {
      title:data?.title || `Incident ${selection.id}`, eyebrow:'Correlated incident',
      summary:data?.narrative || 'This incident groups related stored alerts into one evidence-backed investigation path.',
    };
  }
  if (selection.type === 'asset') {
    const count = Number(data?.total || data?.alerts?.length || 0);
    return {
      title:businessAssetLabel(data || selection.id), eyebrow:'Business asset exposure',
      summary: count
        ? `${count} matching security activit${count === 1 ? 'y was' : 'ies were'} found for this asset. Review the timeline to understand the observed behaviors and affected identities.`
        : 'No matching stored security activity was found for this asset.',
    };
  }
  if (selection.type === 'metric') {
    return {
      title:data?.title || 'Executive metric evidence', eyebrow:'Metric definition and evidence',
      summary:data?.summary || 'This metric is grounded in the stored evidence and limitations shown here.',
    };
  }
  const win = operationWin(data || {});
  const incident = data?.incident;
  const verdict = asObject(data?.alert?.verdict);
  return {
    title:win.title, eyebrow:'AI-assisted workflow outcome',
    summary:incident?.narrative || verdict.summary || win.summary,
  };
}

function impactFor(state, evidence) {
  const incident = incidentFromState(state);
  if (incident?.severity) return incident.severity;
  if (state.selection?.type === 'risk-summary') return 'mixed';
  if (state.selection?.type === 'metric') return 'unknown';
  return evidence.sort((a, b) => ({ critical:4, high:3, medium:2, low:1 }[severityOf(b)] || 0) - ({ critical:4, high:3, medium:2, low:1 }[severityOf(a)] || 0))[0]
    ? severityOf(evidence[0]) : 'unknown';
}

function Timeline({ items, selectedIndex, onSelect, isRiskList = false }) {
  if (!items.length) return <div className="rounded-xl border border-dashed border-[#254159] px-5 py-8 text-center text-sm text-[#718a9e]">No record-level evidence is available for this selection.</div>;
  return (
    <ol className="relative space-y-2 before:absolute before:bottom-5 before:left-[17px] before:top-5 before:w-px before:bg-[#254159]" aria-label={isRiskList ? 'Active risk list' : 'Correlated evidence timeline'}>
      {items.map((item, index) => {
        const severity = item.severity || severityOf(item);
        const title = isRiskList ? item.title || `Incident ${item.id}` : activityTitle(item);
        const timestamp = item.timestamp || item.last_seen || item.updated_at;
        return (
          <li key={item.id || item.incident_key || `${timestamp}-${index}`} className="relative">
            <button
              type="button"
              onClick={() => onSelect(index)}
              className={`group relative z-10 grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border px-2.5 py-3 text-left transition ${selectedIndex === index ? 'border-[#4c9aff]/60 bg-[#10263a]' : 'border-transparent bg-[#0b1723] hover:border-[#29475f] hover:bg-[#0e1d2b]'}`}
              aria-pressed={selectedIndex === index}
            >
              <span className={`mt-0.5 grid h-7 w-7 place-items-center rounded-full border bg-[#09141f] ${severity === 'critical' ? 'border-[#ff5c6c]/60 text-[#ff7180]' : severity === 'high' ? 'border-[#f7b955]/60 text-[#f7b955]' : 'border-[#39739e] text-[#4c9aff]'}`}><CircleDot size={13} /></span>
              <span className="min-w-0">
                <strong className="block text-sm font-semibold leading-5 text-[#e9f2f8]">{title}</strong>
                <span className="mt-1 block text-xs leading-5 text-[#7891a5]">{isRiskList ? `${humanize(item.severity || 'unknown')} impact proxy` : affectedEntity(item)}</span>
              </span>
              <span className="pt-0.5 text-right text-[11px] tabular-nums text-[#60798c]">{timestamp ? fmtTs(timestamp) : 'Stored evidence'}<ChevronRight className="ml-auto mt-1 h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function DeepDiveDrawer({ state, onClose, onRetry, onOpen }) {
  const closeRef = useRef(null);
  const drawerRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isOpen = state.status !== 'closed';
  const evidence = useMemo(() => evidenceFromState(state), [state]);
  const copy = useMemo(() => drawerCopy(state), [state]);
  const selectedEvidence = evidence[selectedIndex] || evidence[0] || null;
  const impact = impactFor(state, [...evidence]);
  const incident = incidentFromState(state);
  const firstTime = evidence.map(item => item.timestamp || item.first_seen).filter(Boolean).sort()[0];
  const lastTime = evidence.map(item => item.timestamp || item.last_seen).filter(Boolean).sort().at(-1);
  const service = state.selection?.type === 'asset'
    ? businessAssetLabel(state.data || state.selection.id)
    : businessAssetLabel(selectedEvidence || incident?.common_entities?.hosts?.[0] || '');

  useEffect(() => { setSelectedIndex(0); }, [state.selection?.key]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(drawerRef.current?.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = priorOverflow; document.removeEventListener('keydown', handleKey); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90]" aria-live="polite">
      <button type="button" className="absolute inset-0 cursor-default bg-[#01070c]/75 backdrop-blur-[2px]" onClick={onClose} aria-label="Close executive detail" />
      <aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="deep-dive-title" aria-describedby="deep-dive-summary" className="absolute inset-y-0 right-0 flex w-full max-w-[720px] flex-col border-l border-[#203b50] bg-[#07121c] shadow-[-24px_0_70px_rgba(0,0,0,.48)]">
        <header className="sticky top-0 z-20 border-b border-[#1b3448] bg-[#091621]/95 px-5 py-5 backdrop-blur md:px-7">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#4c9aff]"><Workflow size={13} />{copy.eyebrow}</p>
              <h2 id="deep-dive-title" className="text-xl font-semibold leading-7 tracking-[-.02em] text-[#f3f7fb] md:text-2xl">{copy.title}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${impact === 'critical' ? 'border-[#ff5c6c]/40 bg-[#ff5c6c]/10 text-[#ff7a87]' : impact === 'high' ? 'border-[#f7b955]/40 bg-[#f7b955]/10 text-[#f7c66d]' : 'border-[#3879a7] bg-[#183248]/60 text-[#91bddb]'}`}>{impact === 'mixed' ? 'Mixed impact' : `${humanize(impact)} impact`}</span>
                <span className="rounded-full border border-[#27445a] bg-[#0d1d2a] px-2.5 py-1 text-xs text-[#8da4b7]">Read-only review</span>
              </div>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#244159] text-[#8da4b7] transition hover:border-[#3f6c8e] hover:bg-[#102332] hover:text-white" aria-label="Close details"><X size={18} /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-7">
          {state.status === 'loading' && <div className="grid min-h-[320px] place-items-center"><div className="text-center text-[#8da4b7]"><RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-[#4c9aff]" /><strong className="block text-sm text-[#dce9f2]">Loading stored evidence</strong><span className="mt-1 block text-xs">Building this view from the SOC database.</span></div></div>}
          {state.status === 'error' && <div className="rounded-xl border border-[#ff5c6c]/30 bg-[#ff5c6c]/[.06] p-5"><AlertTriangle className="mb-3 text-[#ff7280]" /><h3 className="font-semibold text-[#f3f7fb]">Detail could not be loaded</h3><p className="mt-2 text-sm leading-6 text-[#9d7d82]">{state.error}</p><button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#183d65] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#205080]"><RefreshCw size={15} />Try again</button></div>}
          {state.status === 'ready' && <>
            <section className="rounded-2xl border border-[#223d52] bg-[#0b1824] p-5">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.1em] text-[#9b8afb]"><Bot size={14} />{incident?.narrative ? 'AI-generated, grounded in stored evidence' : 'Grounded executive summary'}</div>
              <p id="deep-dive-summary" className="text-[15px] leading-7 text-[#c6d5df]">{copy.summary}</p>
            </section>

            <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key facts">
              {[
                [Building2, 'Business service', service],
                [AlertTriangle, 'Impact basis', `${humanize(impact)} severity proxy`],
                [CalendarClock, 'Detection window', firstTime && lastTime ? `${fmtTs(firstTime)} — ${fmtTs(lastTime)}` : 'Not available'],
                [ShieldCheck, 'Workflow status', humanize(incident?.status || selectedEvidence?.workflow_status || state.data?.status || 'Recorded')],
              ].map(([Icon, label, value]) => <article key={label} className="min-w-0 rounded-xl border border-[#1c3549] bg-[#091722] p-3"><Icon className="mb-3 h-4 w-4 text-[#4c9aff]" /><span className="block text-[11px] font-semibold uppercase tracking-[.08em] text-[#607a8e]">{label}</span><strong className="mt-1.5 block break-words text-xs font-semibold leading-5 text-[#d9e5ed]">{value}</strong></article>)}
            </section>

            <section className="mt-7">
              <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.1em] text-[#607a8e]">Evidence path</p><h3 className="mt-1 text-base font-semibold text-[#eef5f9]">{state.selection?.type === 'risk-summary' ? 'Open correlated risks' : 'Correlation timeline'}</h3></div><span className="rounded-full bg-[#10283a] px-2.5 py-1 text-xs text-[#7fa5c0]">{evidence.length} {state.selection?.type === 'risk-summary' ? 'risks' : 'records'}</span></div>
              <Timeline items={evidence} selectedIndex={selectedIndex} onSelect={index => {
                if (state.selection?.type === 'risk-summary') {
                  const item = evidence[index];
                  onOpen?.({ type:'incident', id:item.id, seed:item });
                } else setSelectedIndex(index);
              }} isRiskList={state.selection?.type === 'risk-summary'} />
            </section>

            {selectedEvidence && state.selection?.type !== 'risk-summary' && <section className="mt-4 rounded-xl border border-[#1e3b50] bg-[#0a1925] p-4">
              <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#607a8e]">Selected evidence</p><h4 className="mt-1.5 text-sm font-semibold text-[#e9f2f8]">{activityTitle(selectedEvidence)}</h4></div><span className="rounded-md border border-[#2d5169] px-2 py-1 text-[11px] font-semibold capitalize text-[#8eb2ca]">{severityOf(selectedEvidence)}</span></div>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs"><div><dt className="text-[#607a8e]">Affected entity</dt><dd className="mt-1 text-[#c3d3de]">{affectedEntity(selectedEvidence)}</dd></div><div><dt className="text-[#607a8e]">Asset type</dt><dd className="mt-1 text-[#c3d3de]">{businessAssetType(selectedEvidence)}</dd></div><div><dt className="text-[#607a8e]">Process / action</dt><dd className="mt-1 text-[#c3d3de]">{selectedEvidence.process || humanize(selectedEvidence.event_action || 'Not supplied')}</dd></div><div><dt className="text-[#607a8e]">Source</dt><dd className="mt-1 text-[#c3d3de]">{humanize(selectedEvidence.event_dataset || selectedEvidence.source_system || 'Elastic')}</dd></div></dl>
            </section>}
          </>}
        </div>

        <footer className="border-t border-[#1b3448] bg-[#091621] px-5 py-4 md:px-7">
          <Link to={technicalLink(state.selection || {}, state.data || {})} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#3e7db4] bg-[#12375b] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#184873]">
            Open Technical Triage Board <ArrowUpRight size={16} />
          </Link>
          <p className="mt-2 text-center text-[11px] text-[#577185]">Opens the evidence-level engineering workspace. No response action is executed here.</p>
        </footer>
      </aside>
    </div>
  );
}
