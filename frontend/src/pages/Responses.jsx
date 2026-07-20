import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, CheckCircle2, RefreshCw, RotateCcw, ShieldOff, UserX } from 'lucide-react';
import { api, fmtTs } from '../lib/api';
import { alertReference, displayReference } from '../lib/executive';

const TYPE_META = {
  endpoint_isolate: { label:'Endpoint isolation', icon:ShieldOff },
  identity_suspend: { label:'Identity suspension', icon:UserX },
  ip_block: { label:'IP block', icon:Ban },
};

const UNKNOWN_TYPE_META = { label:'Unknown response simulation', icon:ShieldOff };

function stateLabel(state) {
  if (state === 'active') return 'Simulation active';
  if (state === 'reverted') return 'Simulation reverted';
  if (state === 'failed') return 'Simulation failed';
  return state ? `Simulation ${state}` : 'Simulation state unknown';
}

export default function Responses() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [state, setState] = useState('all');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = items.find(item => item.id === selectedId) || items[0] || null;

  async function load(nextState = state) {
    setLoading(true);
    setError('');
    try {
      const query = nextState === 'all' ? '' : `&state=${nextState}`;
      const data = await api(`/responses?page=1&limit=100${query}`);
      const responses = data.responses || [];
      setItems(responses);
      setSelectedId(current => responses.some(item => item.id === current) ? current : responses[0]?.id || '');
    } catch (loadError) {
      setError(loadError.message || 'Response simulations could not be loaded.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(state).catch(() => {}); }, [state]);
  useEffect(() => {
    if (!selected?.id) { setDetail(null); return; }
    setError('');
    api(`/responses/${encodeURIComponent(selected.id)}`).then(setDetail).catch(detailError => {
      setDetail(null);
      setError(detailError.message || 'Simulation details could not be loaded.');
    });
  }, [selected?.id]);

  async function requestRollback() {
    if (!selected || selected.state !== 'active' || !reason.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api(`/responses/${encodeURIComponent(selected.id)}/rollback`, {
        method:'POST', body:JSON.stringify({ reason:reason.trim() }),
      });
      setReason('');
      await load(state);
    } catch (rollbackError) {
      setError(rollbackError.message || 'The rollback review request could not be created.');
    } finally { setSaving(false); }
  }

  return <div className="module-page responses-page">
    <div className="module-hero compact"><div><span className="eyebrow"><ShieldOff />Safe response testing</span><h2>Safe Response Simulation</h2><p>Validate what a containment action would target, why it was proposed, and how rollback would work—without changing an external system.</p></div><span className="live-pill"><i />{items.filter(item => item.state === 'active').length} active simulations</span></div>
    <div className="response-safety"><ShieldOff /><div><strong>Proposal → approval → simulated activation → verification → rollback</strong><span>This lab never isolates endpoints, suspends identities, blocks IPs, or writes to Elastic. It is an audited rehearsal environment for safely testing the agent’s response reasoning.</span></div></div>
    {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={() => load()} disabled={loading}>Retry</button></div>}
    <div className="approval-toolbar"><div><button className={state === 'all' ? 'active' : ''} onClick={() => setState('all')}>All simulations</button><button className={state === 'active' ? 'active' : ''} onClick={() => setState('active')}>Simulation active</button><button className={state === 'reverted' ? 'active' : ''} onClick={() => setState('reverted')}>Simulation reverted</button></div><button className="refresh" onClick={() => load()} disabled={loading}><RefreshCw />Refresh</button></div>
    <div className="response-layout">
      <section className="module-panel response-list">
        {items.map(item => { const meta = TYPE_META[item.response_type] || UNKNOWN_TYPE_META; const Icon = meta.icon; return <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><Icon /><div><strong>{meta.label}</strong><small>{item.target_value}</small></div><span className={`response-state ${item.state}`}>{stateLabel(item.state)}</span></button>; })}
        {!loading && !error && !items.length && <div className="module-empty"><ShieldOff /><strong>No {state === 'all' ? '' : state} simulations</strong><span>When the agent proposes a supported containment test, approve it in Human Review Queue and the simulation will appear here.</span><button type="button" onClick={() => navigate('/approvals')}>Open Human Review Queue</button></div>}
      </section>
      <section className="module-panel response-detail">
        {selected ? <>
          <header><div><small>{displayReference('SIM', selected.id)}</small><h3>{(TYPE_META[selected.response_type] || UNKNOWN_TYPE_META).label}</h3><p>{selected.target_value}</p></div><span className={`response-state ${selected.state}`}>{stateLabel(selected.state)}</span></header>
          <dl className="approval-facts"><div><dt>Activated by</dt><dd>{selected.executed_by}</dd></div><div><dt>Activated</dt><dd>{fmtTs(selected.executed_at)}</dd></div><div><dt>Verified</dt><dd>{fmtTs(selected.verified_at)}</dd></div><div><dt>External effects</dt><dd>None — simulation only</dd></div></dl>
          <div className="response-evidence"><strong>Evidence supporting this simulation</strong>{(selected.evidence_alert_ids || []).map(id => <code key={id}>{alertReference(id)}</code>)}</div>
          <div className="response-verification"><CheckCircle2 /><div><strong>Ledger verification</strong><span>{detail?.verification?.verified ? `${detail.verification.observed_state} confirmed in the BMB simulation ledger` : 'Verification unavailable'}</span></div></div>
          {detail?.events?.length > 0 && <div className="response-events"><strong>Audit timeline</strong>{detail.events.map(event => <p key={event.id}><span>{event.event_type}</span>{fmtTs(event.created_at)} · {event.actor}</p>)}</div>}
          {selected.state === 'active' && <div className="approval-decision response-rollback"><label>Rollback reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="Explain why this simulated state should be reverted." /></label><div><button className="approve" disabled={!reason.trim() || saving} onClick={requestRollback}><RotateCcw />Request rollback review</button></div><small>This creates a new request in Human Review Queue; it does not directly change the simulation.</small></div>}
        </> : error ? <div className="module-empty"><ShieldOff /><strong>Simulation data unavailable</strong><span>Retry loading before reviewing response evidence.</span></div> : <div className="module-empty"><ShieldOff /><strong>Select a simulated response</strong><span>Review its supporting evidence, state, verification, and complete audit history.</span></div>}
      </section>
    </div>
  </div>;
}
