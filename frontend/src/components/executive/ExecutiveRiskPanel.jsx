import { ArrowRight, BriefcaseBusiness, UserRound } from 'lucide-react';

function impactClass(severity) {
  if (severity === 'critical') return 'border-[#ef4453]/30 bg-[#ef4453]/10 text-[#ff7b86]';
  if (severity === 'high') return 'border-[#ff8a34]/30 bg-[#ff8a34]/10 text-[#ffa15d]';
  return 'border-[#f2c94c]/30 bg-[#f2c94c]/10 text-[#f5d66d]';
}

export default function ExecutiveRiskPanel({ risks = {}, onSelect }) {
  const items = risks.items || [];
  return (
    <section className="rounded-2xl border border-[#17334a] bg-[#081725] p-5" aria-labelledby="top-risk-title">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-semibold text-[#7891a5]">Business attention</p><h2 id="top-risk-title" className="mt-1 text-lg font-semibold text-[#edf5fa]">Top business risks</h2><p className="mt-1 text-xs leading-5 text-[#668299]">Business impact is a severity proxy until service criticality is mapped.</p></div>
        <span className="rounded-full border border-[#29465d] px-2.5 py-1 text-xs text-[#8ba3b6]">{Number(risks.total || 0)} open</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {items.length ? items.slice(0,3).map(item => (
          <button key={item.id} type="button" onClick={event => onSelect?.(item, event.currentTarget)} className="group grid w-full gap-3 rounded-xl border border-[#173248] bg-[#071521] p-3.5 text-left transition hover:border-[#315a78] sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-center">
            <span className="min-w-0"><span className="flex items-center gap-2"><BriefcaseBusiness size={14} className="shrink-0 text-[#65a4ff]" /><strong className="truncate text-sm font-semibold text-[#dce8f0]">{item.title || `Incident ${item.id}`}</strong></span><span className="mt-1.5 block text-xs text-[#708ca2]">{item.business_service || 'Business service not mapped'} · {item.required_decision || 'Review incident'}</span></span>
            <span className="flex items-center gap-1.5 text-xs text-[#8ba3b6]"><UserRound size={13} />{item.owner || 'No owner'}</span>
            <span className="flex items-center gap-2"><i className={`rounded-full border px-2 py-1 text-[10px] font-semibold not-italic capitalize ${impactClass(item.severity)}`}>{item.business_impact || item.severity || 'unknown'} impact</i><ArrowRight size={14} className="text-[#56758c] transition group-hover:translate-x-0.5" /></span>
          </button>
        )) : <div className="rounded-xl border border-dashed border-[#27445a] px-4 py-7 text-center"><strong className="text-sm text-[#bdd0dd]">No open incident risks</strong><p className="mt-1 text-xs text-[#668299]">No open incident records were returned.</p></div>}
      </div>
    </section>
  );
}
