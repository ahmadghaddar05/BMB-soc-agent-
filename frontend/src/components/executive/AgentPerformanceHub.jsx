import {
  Bot, CheckCircle2, ChevronRight, Clock3, FileSearch, GitMerge, RadioTower,
  ScanSearch, ShieldCheck, Sparkles,
} from 'lucide-react';
import { fmtTs } from '../../lib/api';
import { humanize, operationWin, pipelineState } from '../../lib/executive';

const STAGES = [
  { id:'collect', label:'Collect', copy:'Read new Elastic detections', icon:RadioTower },
  { id:'enrich', label:'Enrich', copy:'Resolve identity and asset context', icon:ScanSearch },
  { id:'triage', label:'Triage', copy:'Prioritize eligible security activity', icon:Sparkles },
  { id:'correlate', label:'Correlate', copy:'Connect related evidence into incidents', icon:GitMerge },
  { id:'workflow', label:'Workflow', copy:'Create investigations and grounded notes', icon:FileSearch },
];

function sourceLabel(operation) {
  return operation.source_type === 'case' ? `Case ${operation.source_id}` : `Alert ${String(operation.source_id || '').slice(0,18)}`;
}

export default function AgentPerformanceHub({ agent = {}, collector = {}, loading = false, error = null, onReview }) {
  const current = error
    ? { stage:'unavailable', message:'Agent status is temporarily unavailable', active:false }
    : loading ? { stage:'unknown', message:'Checking autonomous agent status', active:false }
      : pipelineState(agent, collector);
  const activeIndex = STAGES.findIndex(stage => stage.id === current.stage);
  const readiness = agent.readiness || {};
  const operations = (agent.recent_operations || []).filter(item => item.status === 'completed').slice(0,3);
  const lastRun = agent.latest_run;

  return (
    <section className="rounded-2xl border border-[#1d374b] bg-[#0b1722] p-5 shadow-[0_18px_45px_rgba(0,0,0,.14)] md:p-6" aria-labelledby="agent-performance-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1a3346] pb-5"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#9b8afb]">Autonomous agent performance</p><h2 id="agent-performance-title" className="mt-1.5 text-lg font-semibold tracking-[-.02em] text-[#f0f6fa]">AI Operations Hub</h2><p className="mt-1 text-sm text-[#8098aa]">Internal triage, correlation, and investigation workflows. External response remains approval-gated and simulation-only.</p></div><span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${error || loading || agent.enabled == null ? 'border-[#7891a5]/30 bg-[#7891a5]/[.07] text-[#a8bac7]' : agent.enabled ? 'border-[#33d69f]/30 bg-[#33d69f]/[.07] text-[#50dcae]' : 'border-[#f7b955]/30 bg-[#f7b955]/[.07] text-[#f7c66d]'}`}><i className={`h-1.5 w-1.5 rounded-full ${error || loading || agent.enabled == null ? 'bg-[#7891a5]' : agent.enabled ? 'bg-[#33d69f] shadow-[0_0_8px_#33d69f]' : 'bg-[#f7b955]'}`} />{error ? 'Status unavailable' : loading || agent.enabled == null ? 'Checking status' : agent.enabled ? 'Automation enabled' : 'Automation disabled'}</span></div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(300px,.85fr)_minmax(0,1.35fr)]">
        <div className="rounded-xl border border-[#1c3549] bg-[#091722] p-4 md:p-5">
          <div className="flex items-start gap-3"><span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${current.active ? 'bg-[#9b8afb]/15 text-[#b4a8ff] shadow-[0_0_24px_rgba(155,138,251,.12)]' : 'bg-[#143047] text-[#66aee0]'}`}><Bot size={19} /></span><div><p className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#8098aa]">Agent pipeline status</p><h3 className="mt-1 text-sm font-semibold leading-6 text-[#dce8ef]">{current.message}</h3>{lastRun?.finished_at && <span className="mt-1.5 flex items-center gap-1.5 text-xs text-[#7891a5]"><Clock3 size={12} />Last completed {fmtTs(lastRun.finished_at)}</span>}</div></div>

          <ol className="relative mt-6 space-y-1 before:absolute before:bottom-5 before:left-[15px] before:top-5 before:w-px before:bg-[#244157]" aria-label="Agent workflow stages">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const isActive = activeIndex === index;
              const configured = stage.id === 'collect' ? readiness.scheduler === true : stage.id === 'triage' ? readiness.triage === true : stage.id === 'correlate' ? readiness.correlation === true : stage.id === 'workflow' ? readiness.autonomous === true : null;
              return <li key={stage.id} className={`relative z-10 grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1 py-2.5 ${isActive ? 'bg-[#151f36]' : ''}`}><span className={`grid h-8 w-8 place-items-center rounded-full border bg-[#091722] ${isActive ? 'border-[#9b8afb] text-[#b4a8ff] shadow-[0_0_16px_rgba(155,138,251,.24)]' : configured === true ? 'border-[#2b5f61] text-[#42c59c]' : 'border-[#3b4650] text-[#7f93a3]'}`}>{configured === true && !isActive ? <CheckCircle2 size={15} /> : <Icon size={14} />}</span><span><strong className="block text-sm font-medium text-[#c9d8e2]">{stage.label}</strong><small className="mt-0.5 block text-xs text-[#7891a5]">{stage.copy}</small></span>{isActive && <span className="rounded-full bg-[#9b8afb]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[.08em] text-[#b5a9ff]">Active</span>}</li>;
            })}
          </ol>
        </div>

        <div>
          <div className="flex items-center justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#8098aa]">Recent automated wins</p><h3 className="mt-1 text-base font-semibold text-[#eaf2f7]">Completed internal workflow outcomes</h3></div>{Number(agent.pending_approvals || 0) > 0 && <span className="rounded-full border border-[#f7b955]/30 bg-[#f7b955]/[.07] px-2.5 py-1 text-xs text-[#f7c66d]">{agent.pending_approvals} awaiting approval</span>}</div>
          <div className="mt-4 space-y-3">
            {operations.length ? operations.map(operation => {
              const win = operationWin(operation);
              return <article key={operation.id} className="grid gap-4 rounded-xl border border-[#1d394d] bg-[#091722] p-4 transition hover:border-[#2d526d] sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:items-center"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#33d69f]/10 text-[#44d6a6]"><ShieldCheck size={17} /></span><div className="min-w-0"><h4 className="text-sm font-semibold text-[#dce8ef]">{win.title}</h4><p className="mt-1 text-xs leading-5 text-[#8098aa]">{win.summary}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#7891a5]"><span>{sourceLabel(operation)}</span><span>{humanize(operation.operation_type)}</span><time>{fmtTs(operation.finished_at || operation.updated_at)}</time></div></div><button type="button" onClick={event => onReview?.(operation, event.currentTarget)} className="inline-flex items-center justify-center gap-1.5 self-center rounded-lg border border-[#315b78] px-3 py-2 text-xs font-semibold text-[#9bc8e7] transition hover:border-[#4a7fa2] hover:bg-[#10283a] hover:text-white">Review details<ChevronRight size={14} /></button></article>;
            }) : <div className="grid min-h-[250px] place-items-center rounded-xl border border-dashed border-[#244159] bg-[#09151f]"><div className="max-w-sm text-center"><Bot className="mx-auto mb-3 text-[#425f77]" /><strong className="text-sm text-[#c3d3de]">No completed autonomous outcomes yet</strong><p className="mt-2 text-xs leading-5 text-[#657e91]">Completed evidence-backed investigations and case updates will appear here.</p></div></div>}
          </div>
        </div>
      </div>
    </section>
  );
}
