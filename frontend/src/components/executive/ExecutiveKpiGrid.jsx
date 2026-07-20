import { Bot, BriefcaseBusiness, Clock3, ShieldCheck } from 'lucide-react';
import { asNumber, humanize } from '../../lib/executive';

function percentage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function CardShell({ children, onClick, label }) {
  const className = 'group min-h-[190px] w-full rounded-2xl border border-[#1d374b] bg-[#0b1722] p-5 text-left shadow-[0_18px_45px_rgba(0,0,0,.14)] transition hover:border-[#31536d] hover:bg-[#0d1b28] focus:outline-none focus:ring-2 focus:ring-[#4c9aff]/60';
  return onClick
    ? <button type="button" onClick={onClick} aria-label={label} className={className}>{children}</button>
    : <article className={className}>{children}</article>;
}

function Header({ icon: Icon, title, tone = 'blue' }) {
  const tones = { blue:'text-[#4c9aff] bg-[#4c9aff]/10', purple:'text-[#a797ff] bg-[#9b8afb]/10', green:'text-[#33d69f] bg-[#33d69f]/10', amber:'text-[#f7b955] bg-[#f7b955]/10' };
  return <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`}><Icon size={17} /></span><h3 className="text-sm font-semibold text-[#dce7ee]">{title}</h3></div></div>;
}

export default function ExecutiveKpiGrid({ overview, onOpenRisks }) {
  const health = overview?.health || {};
  const risks = overview?.business_risks || {};
  const automation = overview?.automation || {};
  const saved = overview?.time_saved || {};
  const hasHealthTelemetry = health.telemetry_sufficient !== false;
  const healthScore = hasHealthTelemetry ? percentage(health.score) : null;
  const triageRate = percentage(automation.triage_rate);
  const riskBreakdown = risks.by_impact || {};
  const savedHours = Number(saved.hours);
  const hoursAvailable = Number.isFinite(savedHours);
  const healthTone = healthScore == null ? 'text-[#9aafbd]' : healthScore >= 80 ? 'text-[#36c5f0]' : healthScore >= 60 ? 'text-[#f7b955]' : 'text-[#ff7180]';

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Executive security scorecard">
      <CardShell>
        <Header icon={ShieldCheck} title="Global Security Health Index" />
        <div className="mt-6 flex items-end justify-between gap-4">
          <div><strong className={`block text-[38px] font-semibold leading-none tracking-[-.045em] tabular-nums ${healthTone}`}>{healthScore == null ? '—' : healthScore}<span className="ml-1 text-lg font-medium text-[#8098aa]">/100</span></strong><p className="mt-2 text-sm font-medium text-[#a9bac6]">{!hasHealthTelemetry ? 'Not enough telemetry' : health.status ? humanize(health.status) : 'Posture unavailable'}</p></div>
          <span className="text-right text-xs leading-5 text-[#8098aa]">Lower<br />exposure is better</span>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#172b3c]" aria-hidden="true"><i className="block h-full rounded-full bg-gradient-to-r from-[#397eff] to-[#36c5f0]" style={{ width:`${healthScore || 0}%` }} /></div>
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-[#8098aa]">{!hasHealthTelemetry ? 'Waiting for sufficient security activity before calculating a posture score.' : health.drivers?.[0]?.label ? `${health.drivers[0].label}: ${asNumber(health.drivers[0].value).toLocaleString()}` : 'Derived from current incident exposure, alert severity, and AI workflow backlog.'}</p>
      </CardShell>

      <CardShell onClick={onOpenRisks} label="Review active business risks">
        <Header icon={BriefcaseBusiness} title="Active Business Risks" tone="amber" />
        <div className="mt-6 flex items-end justify-between gap-3"><strong className="text-[40px] font-semibold leading-none tracking-[-.045em] text-[#f3f7fb] tabular-nums">{asNumber(risks.total).toLocaleString()}</strong><span className="rounded-full border border-[#f7b955]/30 bg-[#f7b955]/[.08] px-2.5 py-1 text-xs font-semibold text-[#f7c66d]">Potential impact</span></div>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          {[
            ['High', riskBreakdown.high, '#ff7180'], ['Medium', riskBreakdown.medium, '#f7b955'], ['Low', riskBreakdown.low, '#33d69f'],
          ].map(([label, value, color]) => <div key={label} className="rounded-lg bg-[#0f202e] px-2 py-2.5"><strong className="block text-sm tabular-nums" style={{ color }}>{asNumber(value)}</strong><span className="mt-1 block text-[11px] text-[#688195]">{label}</span></div>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-[#8098aa]">Impact is severity-derived until business criticality is mapped.</p>
      </CardShell>

      <CardShell>
        <Header icon={Bot} title="AI Triage Coverage" tone="purple" />
        <div className="mt-6"><strong className="block text-[40px] font-semibold leading-none tracking-[-.045em] text-[#b5a9ff] tabular-nums">{triageRate == null ? '—' : `${triageRate}%`}</strong><p className="mt-2 text-sm font-medium text-[#a9bac6]">AI triage coverage</p></div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#172b3c]" aria-hidden="true"><i className="block h-full rounded-full bg-gradient-to-r from-[#765ee8] to-[#b19cff]" style={{ width:`${triageRate || 0}%` }} /></div>
        <p className="mt-3 text-xs leading-5 text-[#8098aa]">{asNumber(automation.triaged).toLocaleString()} of {asNumber(automation.activities_seen).toLocaleString()} activities received AI triage. Correlation and investigation outputs are tracked separately; automatic incident closure and external containment are not enabled.</p>
      </CardShell>

      <CardShell>
        <Header icon={Clock3} title="Estimated Analyst Time Saved" tone="green" />
        <div className="mt-6"><strong className="block text-[40px] font-semibold leading-none tracking-[-.045em] text-[#56e2b3] tabular-nums">{hoursAvailable ? Math.round(savedHours).toLocaleString() : '—'}<span className="ml-1.5 text-lg font-medium text-[#739789]">hours</span></strong><p className="mt-2 text-sm font-medium text-[#9eb1bf]">During the last {asNumber(saved.period_days, 7)} days</p></div>
        <p className="mt-5 text-xs leading-5 text-[#8098aa]">{typeof saved.methodology === 'string' ? saved.methodology : saved.methodology?.summary || 'Estimated from completed triage, correlation, investigation, and documentation work—not token usage.'}</p>
      </CardShell>
    </section>
  );
}
