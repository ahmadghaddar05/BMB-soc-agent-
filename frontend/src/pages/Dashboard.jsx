import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import ExecutiveKpiGrid from '../components/executive/ExecutiveKpiGrid';
import RiskTrendChart from '../components/executive/RiskTrendChart';
import BusinessAssetList from '../components/executive/BusinessAssetList';
import AgentPerformanceHub from '../components/executive/AgentPerformanceHub';
import DeepDiveDrawer from '../components/executive/DeepDiveDrawer';
import useDeepDiveDrawer from '../hooks/useDeepDiveDrawer';
import { api } from '../lib/api';

const PERIODS = [7, 30, 90];

function freshnessLabel(value) {
  if (!value) return 'Awaiting first refresh';
  return `Updated ${new Date(value).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
}

function OverviewUnavailable({ message }) {
  return <section className="rounded-2xl border border-[#f7b955]/25 bg-[#f7b955]/[.05] px-5 py-8 text-center"><ShieldAlert className="mx-auto text-[#f7b955]" /><h2 className="mt-3 text-base font-semibold text-[#e6edf2]">Executive metrics are temporarily unavailable</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#8b8f8e]">{message || 'The operational workspaces remain available while the executive data model reconnects.'}</p></section>;
}

export default function Dashboard() {
  const [period, setPeriod] = useState(30);
  const [overview, setOverview] = useState(null);
  const [agent, setAgent] = useState(null);
  const [collector, setCollector] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const loadingRef = useRef(false);
  const drawer = useDeepDiveDrawer();

  const load = useCallback(async signal => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const results = await Promise.allSettled([
      api(`/executive/overview?days=${period}`, { signal }),
      api('/agent/status', { signal }),
      api('/collector/status', { signal }),
    ]);
    if (signal?.aborted) { loadingRef.current = false; return; }
    const [overviewResult, agentResult, collectorResult] = results;
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
    if (agentResult.status === 'fulfilled') setAgent(agentResult.value);
    if (collectorResult.status === 'fulfilled') setCollector(collectorResult.value);
    setErrors({
      overview:overviewResult.status === 'rejected' ? overviewResult.reason?.message : null,
      agent:agentResult.status === 'rejected' ? agentResult.reason?.message : null,
      collector:collectorResult.status === 'rejected' ? collectorResult.reason?.message : null,
    });
    if (overviewResult.status === 'fulfilled') {
      setUpdatedAt(overviewResult.value.generated_at || new Date().toISOString());
    }
    setLoading(false);
    loadingRef.current = false;
  }, [period]);

  useEffect(() => {
    const controller = new globalThis.AbortController();
    setOverview(null);
    setUpdatedAt(null);
    setErrors({});
    setLoading(true);
    load(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(controller.signal);
    }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); loadingRef.current = false; };
  }, [load]);

  const collectorDelayed = Boolean(errors.collector || collector?.runtime?.last_error || collector?.collector?.scheduler_enabled === false);
  const hasOverview = overview && Object.keys(overview).length > 0;
  const dataWarnings = [
    errors.overview && hasOverview ? 'Executive metrics could not refresh; the last successful snapshot remains visible.' : null,
    errors.agent ? 'AI agent performance is temporarily unavailable.' : null,
    collectorDelayed ? 'Some data sources are delayed, so the executive metrics may be incomplete.' : null,
  ].filter(Boolean);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_52%_-12%,rgba(40,101,145,.13),transparent_36%)] px-4 py-6 text-[#8da4b7] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px]">
        <header className="mb-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#4c9aff]"><Sparkles size={13} />Executive security posture &amp; ROI</p>
            <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-.035em] text-[#f3f7fb]">Security posture at a glance</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7891a5]">Business risk, resilience, and measurable AI-led workload reduction—without operational log noise.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-[#203c51] bg-[#091722] p-1" aria-label="Reporting period">
              {PERIODS.map(days => <button key={days} type="button" onClick={() => setPeriod(days)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${period === days ? 'bg-[#163b60] text-white shadow-sm' : 'text-[#718a9e] hover:bg-[#102331] hover:text-[#b7cad7]'}`} aria-pressed={period === days}>{days} days</button>)}
            </div>
            <span className="text-xs tabular-nums text-[#607a8e]">{freshnessLabel(updatedAt)}</span>
            <button type="button" onClick={() => { const controller = new globalThis.AbortController(); setLoading(true); load(controller.signal); }} disabled={loading} className="grid h-9 w-9 place-items-center rounded-lg border border-[#244159] text-[#7e9ab0] transition hover:border-[#3b6583] hover:bg-[#102331] hover:text-white disabled:opacity-50" aria-label="Refresh executive overview"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </header>

        {dataWarnings.length > 0 && <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#f7b955]/25 bg-[#f7b955]/[.05] px-4 py-3 text-sm text-[#bca370]" role="status"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#f7b955]" /><div><strong className="font-semibold text-[#e4c987]">Some overview data is delayed.</strong><span className="ml-1">{dataWarnings.join(' ')}</span></div></div>}

        <div className="space-y-5 md:space-y-6">
          {hasOverview
            ? <ExecutiveKpiGrid overview={overview} onOpenRisks={event => drawer.open({ type:'risk-summary', id:`${period}-day-risks`, seed:overview.business_risks }, event.currentTarget)} />
            : loading ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4" aria-label="Loading executive metrics">{Array.from({ length:4 }, (_, index) => <span key={index} className="h-[190px] animate-pulse rounded-2xl border border-[#1b3448] bg-[#0b1722]" />)}</div>
              : <OverviewUnavailable message={errors.overview} />}

          <div className="grid gap-5 xl:grid-cols-12">
            <div className="xl:col-span-8"><RiskTrendChart data={overview?.risk_trend || []} windowDays={overview?.window_days || period} /></div>
            <div className="xl:col-span-4"><BusinessAssetList assets={overview?.top_assets || []} onSelect={(asset, trigger) => drawer.open({ type:'asset', id:asset.asset_key || asset.id || asset.name, seed:{ ...asset, window_days:overview?.window_days || period } }, trigger)} /></div>
          </div>

          <AgentPerformanceHub agent={agent || {}} collector={collector || {}} loading={loading && !agent} error={errors.agent} onReview={(operation, trigger) => drawer.open({ type:'automation', id:operation.id, seed:operation }, trigger)} />
        </div>
      </div>

      <DeepDiveDrawer state={drawer.state} onClose={drawer.close} onRetry={drawer.retry} onOpen={(selection, trigger) => drawer.open(selection, trigger)} />
    </div>
  );
}
