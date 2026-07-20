import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';

export default function ExecutiveBriefing({ briefing = {}, onReview }) {
  return (
    <section className="grid gap-4 rounded-2xl border border-[#1c3c57] bg-[linear-gradient(115deg,#0b2032,#091724_62%,#0b1b29)] p-5 shadow-[0_18px_50px_rgba(0,0,0,.18)] lg:grid-cols-[minmax(0,1fr)_310px] lg:items-center" aria-labelledby="executive-briefing-title">
      <div>
        <p className="flex items-center gap-2 text-xs font-semibold text-[#65a4ff]"><ShieldCheck size={15} />Security briefing</p>
        <h2 id="executive-briefing-title" className="mt-2 text-xl font-semibold tracking-[-.025em] text-[#f0f7fc]">{briefing.summary || 'Current security posture is being calculated from stored evidence.'}</h2>
        {briefing.direction == null && briefing.direction_reason && <p className="mt-2 text-xs leading-5 text-[#7891a5]">Trend comparison unavailable: {briefing.direction_reason}</p>}
      </div>
      <div className="rounded-xl border border-[#29465d] bg-[#071521]/70 p-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.1em] text-[#f3bd5c]"><AlertTriangle size={13} />Leadership decision</p>
        <p className="mt-2 text-sm leading-6 text-[#c8d7e1]">{briefing.required_decision || 'No immediate leadership decision is recorded.'}</p>
        <button type="button" onClick={onReview} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#69a9ff] hover:text-[#91c1ff]">Review supporting risks <ArrowRight size={13} /></button>
      </div>
    </section>
  );
}
