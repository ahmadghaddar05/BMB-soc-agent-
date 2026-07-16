import { useEffect, useState } from 'react';
import { Ban, CheckCircle2, RefreshCw, RotateCcw, ShieldOff, UserX } from 'lucide-react';
import { api, fmtTs } from '../lib/api';

const TYPE_META = {
  endpoint_isolate: { label:'Endpoint isolation', icon:ShieldOff },
  identity_suspend: { label:'Identity suspension', icon:UserX },
  ip_block: { label:'IP block', icon:Ban },
};

export default function Responses() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [state, setState] = useState('all');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const selected = items.find(item => item.id === selectedId) || items[0] || null;

  async function load(nextState = state) {
    setLoading(true);
    try {
      const query = nextState === 'all' ? '' : `&state=${nextState}`;
      const data = await api(`/responses?page=1&limit=100${query}`);
      const responses = data.responses || [];
      setItems(responses);
      setSelectedId(current => responses.some(item => item.id === current) ? current : responses[0]?.id || '');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(state).catch(() => {}); }, [state]);
  useEffect(() => {
    if (!selected?.id) { setDetail(null); return; }
    api(`/responses/${encodeURIComponent(selected.id)}`).then(setDetail).catch(() => setDetail(null));
  }, [selected?.id]);

  async function requestRollback() {
    if (!selected || selected.state !== 'active' || !reason.trim()) return;
    setSaving(true);
    try {
      await api(`/responses/${encodeURIComponent(selected.id)}/rollback`, {
        method:'POST', body:JSON.stringify({ reason:reason.trim() }),
      });
      setReason('');
      await load(state);
    } finally { setSaving(false); }
  }

  return <div className="module-page responses-page">
    <div className="module-hero compact"><div><span className="eyebrow"><ShieldOff />Phase 9 response lab</span><h2>Simulated response center</h2><p>Inspect approved response simulations, their evidence, verification, and reversible state.</p></div><span className="live-pill"><i />{items.filter(item => item.state === 'active').length} active simulations</span></div>
    <div className="response-safety"><ShieldOff /><div><strong>Simulation only — zero external side effects</strong><span>These records do not isolate endpoints, suspend accounts, block IPs, or write to Elastic. Every activation and rollback is approval-gated and audited inside BMB.</span></div></div>
    <div className="approval-toolbar"><div><button className={state === 'all' ? 'active' : ''} onClick={() => setState('all')}>All</button><button className={state === 'active' ? 'active' : ''} onClick={() => setState('active')}>Active</button><button className={state === 'reverted' ? 'active' : ''} onClick={() => setState('reverted')}>Reverted</button></div><button className="refresh" onClick={() => load()} disabled={loading}><RefreshCw />Refresh</button></div>
    <div className="response-layout">
      <section className="module-panel response-list">
        {items.map(item => { const meta = TYPE_META[item.response_type] || TYPE_META.ip_block; const Icon = meta.icon; return <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><Icon /><div><strong>{meta.label}</strong><small>{item.target_value}</small></div><span className={`response-state ${item.state}`}>{item.state}</span></button>; })}
        {!loading && !items.length && <div className="module-empty"><ShieldOff /><strong>No {state === 'all' ? '' : state} simulations</strong><span>Approved Phase 9 response simulations will appear here.</span></div>}
      </section>
      <section className="module-panel response-detail">
        {selected ? <><header><div><small>SIMULATION {String(selected.id).slice(0, 8)}</small><h3>{TYPE_META[selected.response_type]?.label || selected.response_type}</h3><p>{selected.target_value}</p></div><span className={`response-state ${selected.state}`}>{selected.state}</span></header>
          <dl className="approval-facts"><div><dt>Executed by</dt><dd>{selected.executed_by}</dd></div><div><dt>Executed</dt><dd>{fmtTs(selected.executed_at)}</dd></div><div><dt>Verified</dt><dd>{fmtTs(selected.verified_at)}</dd></div><div><dt>External effects</dt><dd>None</dd></div></dl>
          <div className="response-evidence"><strong>Evidence-bound alert IDs</strong>{(selected.evidence_alert_ids || []).map(id => <code key={id}>{id}</code>)}</div>
          <div className="response-verification"><CheckCircle2 /><div><strong>Verification</strong><span>{detail?.verification?.verified ? `${detail.verification.observed_state} confirmed in BMB simulation ledger` : 'Verification unavailable'}</span></div></div>
          {detail?.events?.length > 0 && <div className="response-events"><strong>Audit timeline</strong>{detail.events.map(event => <p key={event.id}><span>{event.event_type}</span>{fmtTs(event.created_at)} · {event.actor}</p>)}</div>}
          {selected.state === 'active' && <div className="approval-decision response-rollback"><label>Rollback reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="Explain why this simulated state should be reverted." /></label><div><button className="approve" disabled={!reason.trim() || saving} onClick={requestRollback}><RotateCcw />Request approved rollback</button></div><small>The request will appear in Approvals; this button does not revert the state directly.</small></div>}
        </> : <div className="module-empty"><ShieldOff /><strong>Select a simulated response</strong><span>Review its evidence, state, and complete audit history.</span></div>}
      </section>
    </div>
  </div>;
}
