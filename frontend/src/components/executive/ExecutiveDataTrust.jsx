import { CheckCircle2, CircleAlert, Database, RefreshCw } from 'lucide-react';

function status(value) {
  if (value === true) return ['Healthy', 'text-[#43d5a2]'];
  if (value === false) return ['Degraded', 'text-[#f3bd5c]'];
  return ['Unknown', 'text-[#7891a5]'];
}

export default function ExecutiveDataTrust({ health = {}, coverage = {}, generatedAt }) {
  const services = health.services || {};
  const checks = [
    ['Elastic', services.alert_source?.reachable ?? (health.source === 'elastic' ? true : null), 'Risk and incident metrics'],
    ['Enrichment', services.enrichment?.reachable ?? null, 'Identity, asset, threat and vulnerability context'],
    ['Asset mapping', coverage.asset_mapping_percent == null ? null : coverage.asset_mapping_percent > 0, `${coverage.asset_mapping_percent ?? '—'}% of activities`],
    ['AI service', services.hermes?.reachable ?? null, 'New AI-assisted outputs'],
  ];
  return (
    <section className="rounded-2xl border border-[#17334a] bg-[#081725] p-5" aria-labelledby="data-trust-title">
      <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-semibold text-[#7891a5]"><Database size={14} />Source coverage</p><h2 id="data-trust-title" className="mt-1 text-lg font-semibold text-[#edf5fa]">Can this view be trusted?</h2></div><span className="flex items-center gap-1.5 text-[11px] text-[#607c92]"><RefreshCw size={11} />{generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : 'Not refreshed'}</span></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {checks.map(([label, ok, impact]) => { const [copy, color] = status(ok); const Icon = ok === false ? CircleAlert : CheckCircle2; return <div key={label} className="rounded-xl border border-[#143047] bg-[#071521] p-3"><div className="flex items-center justify-between gap-3"><strong className="text-xs text-[#bdd0dd]">{label}</strong><span className={`flex items-center gap-1 text-[11px] font-semibold ${color}`}><Icon size={11} />{copy}</span></div><p className="mt-1.5 text-[11px] leading-4 text-[#607c92]">{impact}</p></div>; })}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-[#607c92]">Threat-intelligence and vulnerability freshness are unavailable from the current health contract. Business-service mapping is not connected; affected executive metrics remain blank.</p>
    </section>
  );
}
