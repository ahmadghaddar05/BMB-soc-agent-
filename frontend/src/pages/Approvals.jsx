import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, FileCheck2, RefreshCw, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import { api, fmtTs } from '../lib/api';

const LABELS = {
  'investigation.create': 'Create investigation',
  'investigation.add_note': 'Add investigation note',
  'case.add_note': 'Add case note',
  'investigation.update': 'Update investigation',
  'case.update': 'Update case',
};

function statusTone(status) {
  if (status === 'executed') return 'executed';
  if (status === 'denied' || status === 'failed') return 'denied';
  return 'pending';
}

export default function Approvals() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState('pending');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = items.find(item => item.id === selectedId) || items[0] || null;
  const counts = useMemo(() => ({
    pending: items.filter(item => item.status === 'pending').length,
    executed: items.filter(item => item.status === 'executed').length,
    denied: items.filter(item => item.status === 'denied').length,
  }), [items]);

  async function load(nextStatus = status) {
    setLoading(true);
    try {
      const query = nextStatus === 'all' ? '' : `&status=${encodeURIComponent(nextStatus)}`;
      const data = await api(`/actions?page=1&limit=100${query}`);
      const actions = data.actions || [];
      setItems(actions);
      setSelectedId(current => actions.some(item => item.id === current) ? current : actions[0]?.id || '');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(status).catch(() => {}); }, [status]);

  async function decide(decision) {
    if (!selected || !reason.trim()) return;
    setSaving(true);
    try {
      const result = await api(`/actions/${encodeURIComponent(selected.id)}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      setItems(current => current.map(item => item.id === selected.id ? result.action_request : item));
      setReason('');
      await load(status);
    } finally { setSaving(false); }
  }

  return <div className="module-page approvals-page">
    <div className="module-hero compact"><div><span className="eyebrow"><ShieldCheck />Controlled AI actions</span><h2>Approval queue</h2><p>Review every sensitive workflow change requested by Hermes before the BMB application executes it.</p></div><span className="live-pill"><i />{counts.pending} awaiting decision</span></div>
    <div className="approval-policy"><ShieldCheck /><div><strong>Phase 7 safety boundary</strong><span>Investigation creation and notes are low risk. Owner and status changes require approval. Host isolation, account disablement, IP blocking, and other external response actions are unavailable.</span></div></div>
    <div className="approval-toolbar"><div><button className={status === 'pending' ? 'active' : ''} onClick={() => setStatus('pending')}>Pending</button><button className={status === 'executed' ? 'active' : ''} onClick={() => setStatus('executed')}>Executed</button><button className={status === 'denied' ? 'active' : ''} onClick={() => setStatus('denied')}>Denied</button><button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>All</button></div><button className="refresh" onClick={() => load()} disabled={loading}><RefreshCw />Refresh</button></div>
    <div className="approval-layout">
      <section className="module-panel approval-list">
        {items.map(item => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><span className={`approval-status ${statusTone(item.status)}`}>{item.status === 'executed' ? <CheckCircle2 /> : item.status === 'pending' ? <Clock3 /> : <XCircle />}</span><div><strong>{LABELS[item.action_type] || item.action_type}</strong><small>{item.target_type} {item.target_id === 'new' ? 'new record' : item.target_id} · requested by {item.requested_by}</small></div><em>{item.status}</em></button>)}
        {!loading && !items.length && <div className="module-empty"><FileCheck2 /><strong>No {status === 'all' ? '' : status} action requests</strong><span>Hermes-controlled changes will appear here with their full reason and parameters.</span></div>}
      </section>
      <section className="module-panel approval-detail">
        {selected ? <><div className="approval-detail-head"><div><small>ACTION {String(selected.id).slice(0, 8)}</small><h3>{LABELS[selected.action_type] || selected.action_type}</h3><p>{selected.reason}</p></div><span className={`approval-chip ${statusTone(selected.status)}`}>{selected.status}</span></div><dl className="approval-facts"><div><dt>Requested by</dt><dd><UserRound />{selected.requested_by}</dd></div><div><dt>Created</dt><dd>{fmtTs(selected.created_at)}</dd></div><div><dt>Target</dt><dd>{selected.target_type}:{selected.target_id}</dd></div><div><dt>Policy</dt><dd>{selected.policy_version} · {selected.approval_required ? 'approval required' : 'direct'}</dd></div></dl><div className="approval-parameters"><strong>Bounded parameters</strong><pre>{JSON.stringify(selected.parameters || {}, null, 2)}</pre></div>{selected.result && <div className="approval-result"><strong>Execution result</strong><pre>{JSON.stringify(selected.result, null, 2)}</pre></div>}{selected.approvals?.length > 0 && <div className="approval-history"><strong>Decision history</strong>{selected.approvals.map((entry, index) => <p key={`${entry.created_at}-${index}`}>{entry.decision} by {entry.decided_by} · {entry.reason}</p>)}</div>}{selected.status === 'pending' && <div className="approval-decision"><label>Decision reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="Explain why this controlled change should execute or be denied." /></label><div><button className="deny" disabled={!reason.trim() || saving} onClick={() => decide('denied')}><XCircle />Deny</button><button className="approve" disabled={!reason.trim() || saving} onClick={() => decide('approved')}><CheckCircle2 />Approve and execute</button></div></div>}</> : <div className="module-empty"><ShieldCheck /><strong>Select an action request</strong><span>Review the target, reason, and exact parameters before deciding.</span></div>}
      </section>
    </div>
  </div>;
}
