import { Bot, Clock3, ShieldCheck, TriangleAlert } from 'lucide-react';

export default function ExecutiveAiValue({ automation = {}, timeSaved = {}, onOpen }) {
  const triageRate = Number(automation.triage_rate || 0);
  const values = [
    ['AI triage coverage', `${triageRate.toLocaleString(undefined, { maximumFractionDigits:1 })}%`, ShieldCheck],
    ['AI-assisted workflows', Number(automation.investigations_created || 0) + Number(automation.correlated_incidents_created || 0), Bot],
    ['Awaiting approval', Number(automation.pending_approvals || 0), Clock3],
    ['Automation failures', Number(automation.failures || 0), TriangleAlert],
  ];
  return (
    <section className="rounded-2xl border border-[#2f2859] bg-[linear-gradient(120deg,rgba(138,108,255,.08),#081725_45%)] p-5" aria-labelledby="ai-value-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-semibold text-[#aa97ff]"><Bot size={14} />AI-assisted value</p><h2 id="ai-value-title" className="mt-1 text-lg font-semibold text-[#edf5fa]">Evidence-grounded workflow support</h2></div><button type="button" onClick={onOpen} className="rounded-lg border border-[#544590] px-3 py-1.5 text-xs font-semibold text-[#b9aaff] hover:bg-[#8a6cff]/10">View assumptions</button></div>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {values.map(([label, value, Icon]) => <div key={label} className="rounded-xl border border-[#29254b] bg-[#0a1726]/80 p-3"><Icon size={14} className="text-[#9e8cff]" /><strong className="mt-3 block text-xl font-semibold tabular-nums text-[#f0f5fa]">{value}</strong><span className="mt-1 block text-xs text-[#7891a5]">{label}</span></div>)}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-[#708aa0]">Estimated time saved: <strong className="text-[#aebfcb]">{Number(timeSaved.hours || 0).toFixed(1)} hours</strong>. {timeSaved.methodology || 'Calculated from completed internal workflow outputs and explicit task-time assumptions.'} External actions executed: 0.</p>
    </section>
  );
}
