import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import BusinessAssetList from '../components/executive/BusinessAssetList';
import DeepDiveDrawer from '../components/executive/DeepDiveDrawer';
import ExecutiveAiValue from '../components/executive/ExecutiveAiValue';
import ExecutiveBriefing from '../components/executive/ExecutiveBriefing';
import ExecutiveDataTrust from '../components/executive/ExecutiveDataTrust';
import ExecutiveDecisionQueue from '../components/executive/ExecutiveDecisionQueue';
import ExecutiveKpiGrid from '../components/executive/ExecutiveKpiGrid';
import ExecutiveRiskPanel from '../components/executive/ExecutiveRiskPanel';
import RiskTrendChart from '../components/executive/RiskTrendChart';
import useDeepDiveDrawer from '../hooks/useDeepDiveDrawer';
import { api } from '../lib/api';

const PERIODS = [7, 30, 90];

function freshnessLabel(value) {
  if (!value) return 'Awaiting first refresh';
  return `Updated ${new Date(value).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
}

function OverviewUnavailable({ message }) {
  return <section className="rounded-2xl border border-[#f2c94c]/25 bg-[#f2c94c]/[.05] px-5 py-8 text-center"><ShieldAlert className="mx-auto text-[#f2c94c]" /><h2 className="mt-3 text-base font-semibold text-[#e6edf2]">Executive metrics are temporarily unavailable</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#7891a5]">{message || 'Operational workspaces remain available while the executive data model reconnects.'}</p></section>;
}

export default function Dashboard() {
  const [period, setPeriod] = useState(30);
  const [overview, setOverview] = useState(null);
  const [collector, setCollector] = useState(null);
  const [dependencies, setDependencies] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(false);
  const drawer = useDeepDiveDrawer();

  const load = useCallback(async signal => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const results = await Promise.allSettled([
      api(`/executive/overview?days=${period}`, { signal }),
      api('/collector/status', { signal }),
      api('/health/dependencies', { signal }),
    ]);
    if (signal?.aborted) { loadingRef.current = false; return; }
    const [overviewResult, collectorResult, dependencyResult] = results;
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
    if (collectorResult.status === 'fulfilled') setCollector(collectorResult.value);
    if (dependencyResult.status === 'fulfilled') setDependencies(dependencyResult.value);
    setErrors({
      overview:overviewResult.status === 'rejected' ? overviewResult.reason?.message : null,
      collector:collectorResult.status === 'rejected' ? collectorResult.reason?.message : null,
      dependencies:dependencyResult.status === 'rejected' ? dependencyResult.reason?.message : null,
    });
    setLoading(false);
    loadingRef.current = false;
  }, [period]);

  useEffect(() => {
    const controller = new globalThis.AbortController();
    setOverview(null); setErrors({}); setLoading(true);
    load(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(controller.signal);
    }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); loadingRef.current = false; };
  }, [load]);

  const hasOverview = overview && Object.keys(overview).length > 0;
  const collectorDelayed = Boolean(errors.collector || collector?.runtime?.last_error || collector?.collector?.scheduler_enabled === false || dependencies?.services?.alert_source?.reachable === false);
  const openRisks = event => drawer.open({ type:'risk-summary', id:`${period}-day-risks`, seed:overview?.business_risks }, event?.currentTarget || event);
  const openMetric = (id, title, summary, evidenceType = 'risk-summary') => event => drawer.open({ type:'metric', id, seed:{ title, summary, evidence_type:evidenceType, overview } }, event.currentTarget);

  return (
    <main className="executive-dashboard min-h-full bg-[radial-gradient(circle_at_52%_-12%,rgba(40,101,145,.13),transparent_36%)] px-4 py-5 text-[#8da4b7] sm:px-6 lg:px-7">
      <div className="mx-auto max-w-[1680px]">
        <header className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div><p className="text-xs font-semibold text-[#65a4ff]">Executive security posture</p><h1 className="mt-1 text-[27px] font-semibold leading-8 tracking-[-.035em] text-[#f3f7fb]">Risk, resilience, and required decisions</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#7891a5]">A decision-focused view grounded in stored incidents, security activity, and workflow evidence.</p></div>
          <div className="flex flex-wrap items-center gap-3"><div className="inline-flex rounded-xl border border-[#203c51] bg-[#091722] p-1" aria-label="Reporting period">{PERIODS.map(days => <button key={days} type="button" onClick={() => setPeriod(days)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${period === days ? 'bg-[#163b60] text-white' : 'text-[#718a9e] hover:bg-[#102331] hover:text-[#b7cad7]'}`} aria-pressed={period === days}>{days} days</button>)}</div><span className="text-xs tabular-nums text-[#607a8e]">{freshnessLabel(overview?.generated_at)}</span><button type="button" onClick={() => { const controller = new globalThis.AbortController(); setLoading(true); load(controller.signal); }} disabled={loading} className="grid h-9 w-9 place-items-center rounded-lg border border-[#244159] text-[#7e9ab0] hover:bg-[#102331] hover:text-white disabled:opacity-50" aria-label="Refresh executive overview"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button></div>
        </header>

        {(errors.overview && hasOverview) || collectorDelayed ? <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#f2c94c]/25 bg-[#f2c94c]/[.05] px-4 py-3 text-sm text-[#bca370]" role="status"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#f2c94c]" /><span><strong className="text-[#e4c987]">Coverage is degraded.</strong> {errors.overview ? 'The last successful executive snapshot remains visible. ' : ''}{collectorDelayed ? 'Elastic collection may be delayed; affected risk metrics may be incomplete.' : ''}</span></div> : null}

        {hasOverview ? <div className="space-y-4">
          <ExecutiveBriefing briefing={overview.briefing} onReview={openRisks} />
          <ExecutiveKpiGrid overview={overview} onOpenRisks={openRisks} onOpenAssets={openMetric('business-service-coverage', 'Business-service coverage', overview.executive_metrics?.critical_business_services_at_risk?.reason, 'assets')} onOpenMethodology={openMetric('metric-methodology', 'Executive metric methodology', 'Risk exposure is derived from severe activity, open incident pressure, and the pending triage backlog. MTTR remains unavailable until reliable response milestones are stored.')} onOpenAutomation={openMetric('workload-reduction', 'Analyst workload reduction', overview.time_saved?.methodology, 'automation')} />
          <div className="grid gap-4 xl:grid-cols-12"><div className="xl:col-span-8"><RiskTrendChart data={overview.risk_trend || []} windowDays={overview.window_days || period} /></div><div className="xl:col-span-4"><ExecutiveDecisionQueue queue={overview.decision_queue} collectorDelayed={collectorDelayed} onReviewRisks={openRisks} onReviewControls={openMetric('decision-controls', 'Decision queue controls', 'Approval requests, failed internal workflow actions, and degraded source status require review in their role-authorized operational workspaces.', 'automation')} /></div></div>
          <div className="grid gap-4 xl:grid-cols-12"><div className="xl:col-span-7"><ExecutiveRiskPanel risks={overview.business_risks} onSelect={(item, trigger) => drawer.open({ type:'incident', id:item.id, seed:item }, trigger)} /></div><div className="xl:col-span-5"><BusinessAssetList assets={overview.top_assets || []} onSelect={(asset, trigger) => drawer.open({ type:'asset', id:asset.asset_key || asset.id || asset.name, seed:{ ...asset, window_days:overview.window_days || period } }, trigger)} /></div></div>
          <div className="grid gap-4 xl:grid-cols-12"><div className="xl:col-span-7"><ExecutiveAiValue automation={overview.automation} timeSaved={overview.time_saved} onOpen={openMetric('ai-value', 'AI-assisted value assumptions', overview.time_saved?.methodology, 'automation')} /></div><div className="xl:col-span-5"><ExecutiveDataTrust health={dependencies || {}} coverage={overview.source_coverage} generatedAt={overview.generated_at} /></div></div>
        </div> : loading ? <div className="space-y-4" aria-label="Loading executive overview"><span className="block h-32 animate-pulse rounded-2xl border border-[#17334a] bg-[#081725]" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length:5 }, (_, index) => <span key={index} className="h-[202px] animate-pulse rounded-2xl border border-[#17334a] bg-[#081725]" />)}</div></div> : <OverviewUnavailable message={errors.overview} />}
      </div>
      <DeepDiveDrawer state={drawer.state} onClose={drawer.close} onRetry={drawer.retry} onOpen={(selection, trigger) => drawer.open(selection, trigger)} />
    </main>
  );
}
