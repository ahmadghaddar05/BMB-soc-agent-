import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock3, FileCheck2, RefreshCw, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import { api, fmtTs } from '../lib/api';
import { actionReference, friendlyEvidenceText } from '../lib/executive';

const LABELS = {
  'investigation.create': 'Create investigation',
  'investigation.add_note': 'Add investigation finding',
  'case.add_note': 'Add case timeline entry',
  'investigation.update': 'Update investigation',
  'case.update': 'Update case',
  'response.simulate': 'Activate response simulation',
  'response.rollback': 'Rollback response simulation',
};

function statusTone(status) {
  if (status === 'executed') return 'executed';
  if (status === 'denied' || status === 'failed') return 'denied';
  return 'pending';
}

export default function Approvals() {
  const navigate = useNavigate();
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
      await api(`/actions/${encodeURIComponent(selected.id)}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      setReason('');
      await load(status);
    } finally { setSaving(false); }
  }

  return <div className="module-page approvals-page">
    <div className="module-hero compact"><div><span className="eyebrow"><ShieldCheck />Human control point</span><h2>Human Review Queue</h2><p>Approve or deny sensitive changes proposed by the AI. Nothing in this queue executes until an analyst records a reason.</p></div><span className="live-pill"><i />{counts.pending} awaiting decision</span></div>
    <div className="approval-policy"><ShieldCheck /><div><strong>Request → analyst review → bounded execution → audit record</strong><span>Investigation and case changes stay inside BMB. Response actions are simulations only; endpoint isolation, identity suspension, IP blocking, and Elastic write-back are not performed.</span></div></div>
    <div className="approval-toolbar"><div><button className={status === 'pending' ? 'active' : ''} onClick={() => setStatus('pending')}>Pending</button><button className={status === 'executed' ? 'active' : ''} onClick={() => setStatus('executed')}>Executed</button><button className={status === 'denied' ? 'active' : ''} onClick={() => setStatus('denied')}>Denied</button><button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>All history</button></div><button className="refresh" onClick={() => load()} disabled={loading}><RefreshCw />Refresh</button></div>
    <div className="approval-layout">
      <section className="module-panel approval-list">
        {items.map(item => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><span className={`approval-status ${statusTone(item.status)}`}>{item.status === 'executed' ? <CheckCircle2 /> : item.status === 'pending' ? <Clock3 /> : <XCircle />}</span><div><strong>{LABELS[item.action_type] || item.action_type}</strong><small>{actionReference(item)} · {item.target_type} {item.target_id === 'new' ? 'new record' : friendlyEvidenceText(item.target_id)} · requested by {item.requested_by}</small></div><em>{item.status}</em></button>)}
        {!loading && !items.length && <div className="module-empty"><FileCheck2 /><strong>No {status === 'all' ? '' : status} requests</strong><span>This means the AI has not proposed a controlled change in this category. Requests appear when an investigation or case produces a supported next step.</span><button type="button" onClick={() => navigate('/investigations')}>Open investigations</button></div>}
      </section>
      <section className="module-panel approval-detail">
        {selected?.preview && <div className="approval-preview"><strong>What will happen</strong><p>{selected.preview.intended_effect}</p><dl><div><dt>Mode</dt><dd>{selected.preview.mode}</dd></div><div><dt>Connector</dt><dd>{selected.preview.connector}</dd></div><div><dt>External effects</dt><dd>{selected.preview.external_side_effects ? 'Possible' : 'None'}</dd></div><div><dt>Reversible</dt><dd>{selected.preview.reversible ? 'Yes' : 'No'}</dd></div></dl></div>}
        {selected ? <>
          <div className="approval-detail-head"><div><small>{actionReference(selected)}</small><h3>{LABELS[selected.action_type] || selected.action_type}</h3><p>{friendlyEvidenceText(selected.reason)}</p></div><span className={`approval-chip ${statusTone(selected.status)}`}>{selected.status}</span></div>
          <dl className="approval-facts"><div><dt>Requested by</dt><dd><UserRound />{selected.requested_by}</dd></div><div><dt>Created</dt><dd>{fmtTs(selected.created_at)}</dd></div><div><dt>Target</dt><dd>{selected.target_type}: {friendlyEvidenceText(selected.target_id)}</dd></div><div><dt>Safety boundary</dt><dd>{selected.approval_required ? 'Human approval required' : 'Internal direct action'}</dd></div></dl>
          <details className="approval-parameters"><summary>Show bounded technical parameters</summary><pre>{JSON.stringify(selected.parameters || {}, null, 2)}</pre></details>
          {selected.result && <details className="approval-result"><summary>Show execution result</summary><pre>{JSON.stringify(selected.result, null, 2)}</pre></details>}
          {selected.approvals?.length > 0 && <div className="approval-history"><strong>Decision history</strong>{selected.approvals.map((entry, index) => <p key={`${entry.created_at}-${index}`}>{entry.decision} by {entry.decided_by} · {entry.reason}</p>)}</div>}
          {selected.status === 'pending' && <div className="approval-decision"><label>Required decision reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="State the evidence and reason for approving or denying this request." /></label><div><button className="deny" disabled={!reason.trim() || saving} onClick={() => decide('denied')}><XCircle />Deny request</button><button className="approve" disabled={!reason.trim() || saving} onClick={() => decide('approved')}><CheckCircle2 />Approve internal action</button></div></div>}
        </> : <div className="module-empty"><ShieldCheck /><strong>Select a request</strong><span>Review the intended effect, evidence, target, and exact safety boundary before deciding.</span></div>}
      </section>
    </div>
  </div>;
}
