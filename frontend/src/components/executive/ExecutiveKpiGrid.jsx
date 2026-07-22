import {
  AlertOctagon, ArrowRight, Building2, Clock3, Gauge, HelpCircle,
} from 'lucide-react';

function display(value, suffix = '') {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits:1 })}${suffix}`;
}

function Delta({ current, previous, lowerIsBetter = false }) {
  if (previous == null || current == null) return <span>Previous period unavailable</span>;
  const delta = Number(current) - Number(previous);
  if (delta === 0) return <span>No change from previous period</span>;
  const favorable = lowerIsBetter ? delta < 0 : delta > 0;
  return <span className={favorable ? 'text-[#43d5a2]' : 'text-[#f3bd5c]'}>{Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits:1 })} {delta > 0 ? 'higher' : 'lower'} than previous period</span>;
}

function MetricCard({ icon:Icon, title, value, suffix, available = true, reason, definition, confidence, target, previous, lowerIsBetter, onOpen, tone = 'blue' }) {
  const tones = {
    blue:'bg-[#3988ff]/10 text-[#65a4ff]',
    red:'bg-[#ef4453]/10 text-[#ff7480]',
    amber:'bg-[#f2c94c]/10 text-[#f4d267]',
    green:'bg-[#25cf91]/10 text-[#43d5a2]',
  };
  return (
    <article className="flex min-h-[202px] flex-col rounded-2xl border border-[#17334a] bg-[#081725] p-4 shadow-[0_14px_36px_rgba(0,0,0,.16)]">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[tone]}`}><Icon size={17} /></span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7290a8]" title={definition}><HelpCircle size={12} />Definition</span>
      </div>
      <h2 className="mt-4 min-h-10 text-sm font-semibold leading-5 text-[#dce8f1]">{title}</h2>
      <div className="mt-2 flex items-baseline gap-1.5">
        <strong className={`text-[32px] font-semibold leading-none tracking-[-.04em] tabular-nums ${available ? 'text-[#f2f8fc]' : 'text-[#668096]'}`}>{available ? display(value, suffix) : '—'}</strong>
      </div>
      <div className="mt-3 min-h-10 text-xs leading-5 text-[#7891a5]">
        {available ? <Delta current={value} previous={previous} lowerIsBetter={lowerIsBetter} /> : <span>{reason || 'Required source data is unavailable.'}</span>}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-[#10283b] pt-3 text-[11px] text-[#607c92]">
        <div><span className="block">{target != null ? `Target: ${display(target, suffix)}` : 'No validated target'}</span><span className="mt-0.5 block capitalize">Confidence: {confidence || 'unknown'}</span></div>
        <button type="button" onClick={onOpen} aria-label={`Review supporting evidence for ${title}`} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-[#69a9ff] hover:bg-[#3988ff]/10 hover:text-[#8fc0ff]">Evidence <ArrowRight size={12} /></button>
      </div>
    </article>
  );
}

export default function ExecutiveKpiGrid({ overview, onOpenRisks, onOpenAssets, onOpenMethodology, onOpenAutomation }) {
  const metrics = overview?.executive_metrics || {};
  const exposure = metrics.cyber_risk_exposure || {
    value:overview?.health?.score == null ? null : 100 - Number(overview.health.score),
    available:overview?.health?.telemetry_sufficient !== false,
    confidence:'medium', target:20,
  };
  const services = metrics.critical_business_services_at_risk || { available:false, reason:'Business-service mapping is unavailable.' };
  const critical = metrics.open_critical_incidents || { value:overview?.business_risks?.by_impact?.critical ?? 0, available:true, target:0, confidence:'high' };
  const mttr = metrics.mean_time_to_respond || { available:false, reason:'Response milestone timestamps are unavailable.' };
  const workload = metrics.analyst_workload_reduced || { value:overview?.time_saved?.hours, previous_period:overview?.time_saved?.previous_period_hours, available:true, confidence:'estimated' };

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Executive security metrics">
      <MetricCard icon={Gauge} title="Cyber Risk Exposure" value={exposure.value} suffix="/100" available={exposure.available} reason={exposure.reason} definition="A derived exposure score based on severe activity, open incidents, and the triage backlog. Lower is better." confidence={exposure.confidence} target={exposure.target} previous={exposure.previous_period} lowerIsBetter onOpen={onOpenMethodology} />
      <MetricCard icon={Building2} title="Critical Business Services at Risk" value={services.value} available={services.available} reason={services.reason} definition="Count of mapped business services affected by open critical or high-impact incidents." confidence={services.confidence} target={0} previous={services.previous_period} lowerIsBetter onOpen={onOpenAssets} tone="amber" />
      <MetricCard icon={AlertOctagon} title="Open Critical Incidents" value={critical.value} available={critical.available} reason={critical.reason} definition="Currently open incident records whose stored severity is critical." confidence={critical.confidence} target={critical.target} previous={critical.previous_period} lowerIsBetter onOpen={onOpenRisks} tone={Number(critical.value) > 0 ? 'red' : 'green'} />
      <MetricCard icon={Clock3} title="Mean Time to Respond" value={mttr.value} suffix="h" available={mttr.available} reason={mttr.reason} definition="Average elapsed time from detection to a recorded response milestone. Not calculated without trustworthy milestones." confidence={mttr.confidence} target={mttr.target} previous={mttr.previous_period} lowerIsBetter onOpen={onOpenMethodology} />
      <MetricCard icon={Clock3} title="Analyst Workload Reduced" value={workload.value} suffix="h" available={workload.available} reason={workload.reason} definition="Estimated hours avoided using observed AI-assisted workflow outputs and explicit task-time assumptions." confidence={workload.confidence} target={workload.target} previous={workload.previous_period} onOpen={onOpenAutomation} tone="green" />
    </section>
  );
}
