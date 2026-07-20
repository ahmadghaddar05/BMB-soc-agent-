import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
export default function ExecutiveDecisionQueue({ queue = {}, collectorDelayed = false, onReviewRisks, onReviewControls }) {
  const decisions = [
    { label:'Unassigned high-impact incidents', value:Number(queue.unassigned_high_impact_incidents || 0), onClick:onReviewRisks },
    { label:'Approval requests awaiting review', value:Number(queue.pending_approvals || 0), onClick:onReviewControls },
    { label:'Failed internal workflow actions', value:Number(queue.failed_internal_actions || 0), onClick:onReviewControls },
    { label:'Degraded data sources', value:collectorDelayed ? 1 : 0, onClick:onReviewControls },
  ];
  const total = decisions.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="rounded-2xl border border-[#17334a] bg-[#081725] p-5" aria-labelledby="decision-queue-title">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[#7891a5]">Leadership control</p><h2 id="decision-queue-title" className="mt-1 text-lg font-semibold text-[#edf5fa]">Decision queue</h2></div><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${total ? 'border-[#f2c94c]/30 bg-[#f2c94c]/10 text-[#f5d66d]' : 'border-[#25cf91]/30 bg-[#25cf91]/10 text-[#43d5a2]'}`}>{total ? `${total} need attention` : 'Clear'}</span></div>
      <div className="mt-4 divide-y divide-[#10283b]">
        {decisions.map(item => {
          const body = <><span className="flex items-center gap-2 text-sm text-[#b9ccd9]">{item.value ? <AlertTriangle size={14} className="text-[#f3bd5c]" /> : <CheckCircle2 size={14} className="text-[#43d5a2]" />}{item.label}</span><span className="flex items-center gap-2 text-sm font-semibold tabular-nums text-[#e7f0f6]">{item.value}<ArrowRight size={13} className="text-[#58778e]" /></span></>;
          const cls = 'flex w-full items-center justify-between gap-3 py-3 text-left hover:text-white';
          return <button key={item.label} type="button" onClick={item.onClick} className={cls}>{body}</button>;
        })}
      </div>
      {queue.overdue_actions_available === false && <p className="mt-3 border-t border-[#10283b] pt-3 text-[11px] leading-5 text-[#607c92]">Overdue actions are not counted because durable due dates are not stored.</p>}
    </section>
  );
}
