import { useMemo, useState } from 'react';
import { BookOpenCheck, Check, ChevronRight, Clock3, MailWarning, Network, Play, RotateCcw, ShieldAlert, UserX } from 'lucide-react';
import { readLocal, saveLocal } from '../lib/soc';

const PLAYBOOKS = [
  { id:'credential-compromise', name:'Compromised account response', category:'Identity', icon:UserX, severity:'critical', time:'15–25 min', trigger:'Suspicious login, credential theft, or privilege escalation', steps:['Validate identity and recent authentication context','Disable or restrict the affected account','Revoke active sessions and refresh tokens','Reset credentials using the approved channel','Hunt for lateral movement by the identity','Document evidence and notify the incident owner'] },
  { id:'malicious-email', name:'Malicious email containment', category:'Email', icon:MailWarning, severity:'high', time:'10–20 min', trigger:'Phishing, malicious attachment, or impersonation alert', steps:['Confirm sender, recipients, links, and attachments','Quarantine the message across all mailboxes','Block sender, domains, URLs, and hashes','Identify users who opened or executed content','Run endpoint scans for impacted recipients','Record impact and communication actions'] },
  { id:'endpoint-malware', name:'Endpoint malware isolation', category:'Endpoint', icon:ShieldAlert, severity:'critical', time:'20–35 min', trigger:'EDR malware, suspicious process, or persistence detection', steps:['Validate the detection and affected endpoint','Isolate the device from the network','Capture process tree and volatile evidence','Block malicious hashes and indicators','Remove persistence and remediate the host','Restore connectivity after validation'] },
  { id:'network-ioc', name:'Network IOC response', category:'Network', icon:Network, severity:'high', time:'15–30 min', trigger:'Malicious IP, C2 beacon, or suspicious outbound traffic', steps:['Review flow direction and destination reputation','Identify all communicating hosts and identities','Add the indicator to the SOC watchlist','Apply approved network block controls','Hunt for alternate infrastructure and domains','Monitor for recurrence and close with evidence'] },
];

export default function Playbooks() {
  const [activeId, setActiveId] = useState(PLAYBOOKS[0].id);
  const [runs, setRuns] = useState(() => readLocal('bmb-playbook-runs', {}));
  const active = PLAYBOOKS.find(item => item.id === activeId);
  const run = runs[activeId];
  const completed = run?.completed || [];
  const progress = Math.round((completed.length / active.steps.length) * 100);

  function start() { const next = { ...runs, [activeId]: { startedAt:new Date().toISOString(), completed:[], status:'running' } }; setRuns(next); saveLocal('bmb-playbook-runs', next); }
  function toggleStep(index) { if (!run) return; const done = completed.includes(index); const values = done ? completed.filter(value => value !== index) : [...completed,index]; const nextRun = { ...run, completed:values, status: values.length === active.steps.length ? 'complete' : 'running' }; const next = { ...runs, [activeId]:nextRun }; setRuns(next); saveLocal('bmb-playbook-runs', next); }
  function reset() { const next = { ...runs }; delete next[activeId]; setRuns(next); saveLocal('bmb-playbook-runs', next); }

  const activeRuns = useMemo(() => Object.values(runs).filter(item => item.status === 'running').length, [runs]);
  return <div className="module-page playbooks-page">
    <div className="module-hero compact"><div><span className="eyebrow"><BookOpenCheck />Local response guidance</span><h2>Playbooks</h2><p>Browser-local review checklists. They do not execute or verify response actions.</p></div><span className="live-pill"><i />{activeRuns} local checklist{activeRuns === 1 ? '' : 's'} in progress</span></div>
    <div className="playbook-layout"><section className="module-panel playbook-catalog"><div className="panel-heading"><div><BookOpenCheck /><span><strong>Response catalog</strong><small>{PLAYBOOKS.length} approved workflows</small></span></div></div><div className="playbook-list">{PLAYBOOKS.map(item => { const Icon=item.icon; const itemRun=runs[item.id]; return <button key={item.id} className={activeId === item.id ? 'active' : ''} onClick={() => setActiveId(item.id)}><span className={`playbook-icon severity-${item.severity}`}><Icon /></span><div><strong>{item.name}</strong><small>{item.category} · {item.time}</small></div>{itemRun && <em className={itemRun.status}>{itemRun.status}</em>}<ChevronRight /></button>; })}</div></section>
      <section className="module-panel playbook-run"><div className="playbook-head"><span className={`playbook-icon large severity-${active.severity}`}>{<active.icon />}</span><div><small>{active.category} response guidance</small><h3>{active.name}</h3><p>{active.trigger}</p></div><span className="playbook-duration"><Clock3 />{active.time}</span></div><div className="playbook-progress"><span><b style={{width:`${run ? progress : 0}%`}} /></span><small>{run ? `${completed.length} of ${active.steps.length} steps acknowledged locally` : 'Not started'}</small></div><div className="playbook-steps">{active.steps.map((step,index) => <button key={step} className={completed.includes(index) ? 'complete' : ''} onClick={() => toggleStep(index)} disabled={!run}><span>{completed.includes(index) ? <Check /> : index + 1}</span><div><strong>{step}</strong><small>{completed.includes(index) ? 'Acknowledged locally; execution not verified' : 'Awaiting analyst review'}</small></div></button>)}</div><div className="playbook-footer">{!run ? <button className="primary-action" onClick={start}><Play />Start local checklist</button> : <><span className={`run-status ${run.status}`}>{run.status === 'complete' ? 'Local review complete' : 'Local review in progress'}</span><button className="ghost-action" onClick={reset}><RotateCcw />Reset local review</button></>}</div></section></div>
  </div>;
}
