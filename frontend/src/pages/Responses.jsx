import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Ban, CheckCircle2, Clock3, FileCheck2, Info, LockKeyhole,
  RefreshCw, RotateCcw, ShieldCheck, ShieldOff, UserCheck, UserX,
} from 'lucide-react';
import { api, fmtTs } from '../lib/api';
import { alertReference, displayReference } from '../lib/executive';

const TYPE_META = {
  endpoint_isolate: {
    label:'Endpoint isolation',
    subject:'endpoint',
    icon:ShieldOff,
    intent:'Test whether the selected endpoint and supporting alerts justify an isolation recommendation.',
    simulatedEffect:'Marks the endpoint as isolated only inside the BMB simulation ledger.',
  },
  identity_suspend: {
    label:'Identity suspension',
    subject:'identity',
    icon:UserX,
    intent:'Test whether the selected identity and supporting alerts justify a suspension recommendation.',
    simulatedEffect:'Marks the identity as suspended only inside the BMB simulation ledger.',
  },
  ip_block: {
    label:'IP block',
    subject:'IP address',
    icon:Ban,
    intent:'Test whether the selected address and supporting alerts justify a blocking recommendation.',
    simulatedEffect:'Marks the address as blocked only inside the BMB simulation ledger.',
  },
};

const UNKNOWN_TYPE_META = {
  label:'Unknown response simulation',
  subject:'target',
  icon:ShieldOff,
  intent:'Review the stored proposal and its supporting evidence.',
  simulatedEffect:'Changes only the internal BMB simulation ledger.',
};

function stateLabel(state) {
  if (state === 'active') return 'Active rehearsal';
  if (state === 'reverted') return 'Rehearsal closed';
  return 'State unavailable';
}

function DetailLoading() {
  return (
    <div className="response-detail-loading" role="status">
      <RefreshCw className="animate-spin" />
      <div><strong>Loading simulation record</strong><span>Reading its evidence, verification, and audit history.</span></div>
    </div>
  );
}

export default function Responses() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [state, setState] = useState('all');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const visibleItems = useMemo(
    () => state === 'all' ? items : items.filter(item => item.state === state),
    [items, state]
  );
  const selected = visibleItems.find(item => item.id === selectedId) || visibleItems[0] || null;
  const counts = useMemo(() => ({
    active:items.filter(item => item.state === 'active').length,
    reverted:items.filter(item => item.state === 'reverted').length,
  }), [items]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api('/responses?page=1&limit=100');
      const responses = data.responses || [];
      setItems(responses);
      setTotal(Number(data.total || responses.length));
      setSelectedId(current => responses.some(item => item.id === current) ? current : responses[0]?.id || '');
    } catch (loadError) {
      setError(loadError.message || 'Response simulations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch(() => {}); }, []);

  useEffect(() => {
    if (!visibleItems.some(item => item.id === selectedId)) {
      setSelectedId(visibleItems[0]?.id || '');
    }
  }, [state, visibleItems, selectedId]);

  useEffect(() => {
    if (!selected?.id) {
      setDetail(null);
      setDetailLoading(false);
      return undefined;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setError('');
    api(`/responses/${encodeURIComponent(selected.id)}`)
      .then(value => { if (active) setDetail(value); })
      .catch(detailError => {
        if (!active) return;
        setDetail(null);
        setError(detailError.message || 'Simulation details could not be loaded.');
      })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected?.id]);

  async function requestRollback() {
    if (!selected || selected.state !== 'active' || !reason.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api(`/responses/${encodeURIComponent(selected.id)}/rollback`, {
        method:'POST',
        body:JSON.stringify({ reason:reason.trim() }),
      });
      setReason('');
      await load();
    } catch (rollbackError) {
      setError(rollbackError.message || 'The rollback review request could not be created.');
    } finally {
      setSaving(false);
    }
  }

  const meta = selected ? TYPE_META[selected.response_type] || UNKNOWN_TYPE_META : UNKNOWN_TYPE_META;
  const intendedEffect = detail?.preview?.intended_effect || meta.simulatedEffect;

  return (
    <div className="module-page responses-page">
      <div className="module-hero compact response-page-heading">
        <div>
          <span className="eyebrow"><ShieldCheck />Analyst safety workspace</span>
          <h2>Safe Response Simulation</h2>
          <p>Rehearse a containment recommendation, confirm its target and evidence, then test rollback before any real response integration is considered.</p>
        </div>
        <button type="button" className="ghost-action" onClick={() => navigate('/approvals')}><FileCheck2 />Open approval queue</button>
      </div>

      <section className="response-purpose" aria-labelledby="response-purpose-title">
        <div className="response-purpose-copy">
          <span className="response-purpose-icon"><Info /></span>
          <div>
            <small>Purpose of this workspace</small>
            <h3 id="response-purpose-title">Validate the AI recommendation without affecting production</h3>
            <p>Use this page to answer three questions: Is the target correct? Does stored evidence justify the proposed action? Can the action be safely reversed?</p>
          </div>
        </div>
        <div className="response-boundaries">
          <div className="is-safe"><CheckCircle2 /><span><strong>What it does</strong><small>Creates an approved, auditable rehearsal in the BMB ledger.</small></span></div>
          <div className="is-blocked"><LockKeyhole /><span><strong>What it never does</strong><small>No endpoint, identity, firewall, Elastic record, or external system is modified.</small></span></div>
        </div>
      </section>

      <section className="response-flow" aria-label="Simulation workflow">
        {[
          ['1','Proposal','AI or analyst suggests a bounded test'],
          ['2','Human approval','An analyst validates target and evidence'],
          ['3','Ledger rehearsal','BMB records a simulation-only state'],
          ['4','Verify and close','Review the audit trail and test rollback'],
        ].map(([number, title, copy], index) => (
          <article key={number}>
            <span>{number}</span>
            <div><strong>{title}</strong><small>{copy}</small></div>
            {index < 3 && <ArrowRight aria-hidden="true" />}
          </article>
        ))}
      </section>

      <div className="response-metrics" aria-label="Simulation summary">
        <article><span><ShieldOff /></span><div><small>Stored rehearsals</small><strong>{total}</strong></div></article>
        <article><span className="attention"><Clock3 /></span><div><small>Currently active</small><strong>{counts.active}</strong></div></article>
        <article><span className="success"><RotateCcw /></span><div><small>Safely reverted</small><strong>{counts.reverted}</strong></div></article>
        <article><span className="neutral"><LockKeyhole /></span><div><small>Production changes</small><strong>0</strong></div></article>
      </div>

      {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={load} disabled={loading}>Retry</button></div>}

      <div className="approval-toolbar response-toolbar">
        <div role="group" aria-label="Filter simulations by state">
          <button type="button" className={state === 'all' ? 'active' : ''} onClick={() => setState('all')}>All <span>{items.length}</span></button>
          <button type="button" className={state === 'active' ? 'active' : ''} onClick={() => setState('active')}>Active <span>{counts.active}</span></button>
          <button type="button" className={state === 'reverted' ? 'active' : ''} onClick={() => setState('reverted')}>Reverted <span>{counts.reverted}</span></button>
        </div>
        <button type="button" className="refresh" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button>
      </div>

      <div className="response-layout">
        <section className="module-panel response-list-panel" aria-label="Response simulation records">
          <header><div><strong>Simulation records</strong><small>Newest activity first</small></div><span>{visibleItems.length}</span></header>
          <div className="response-records">
            {visibleItems.map(item => {
              const itemMeta = TYPE_META[item.response_type] || UNKNOWN_TYPE_META;
              const Icon = itemMeta.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={selected?.id === item.id ? 'active' : ''}
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={selected?.id === item.id}
                >
                  <span className="response-record-icon"><Icon /></span>
                  <span className="response-record-main">
                    <strong>{itemMeta.label}</strong>
                    <small title={item.target_value}>{item.target_value || 'Target unavailable'}</small>
                    <code>{displayReference('SIM', item.id)}</code>
                  </span>
                  <span className={`response-state ${item.state}`}>{stateLabel(item.state)}</span>
                </button>
              );
            })}
            {loading && !items.length && <div className="module-empty small" role="status"><RefreshCw className="animate-spin" /><strong>Loading response rehearsals</strong><span>Reading simulation-only records from the BMB ledger.</span></div>}
            {!loading && !error && !visibleItems.length && (
              <div className="module-empty">
                <ShieldOff />
                <strong>No {state === 'all' ? '' : state} rehearsals</strong>
                <span>Approved simulation proposals appear here. This page never generates a real containment action.</span>
                <button type="button" onClick={() => navigate('/approvals')}>Review pending approvals</button>
              </div>
            )}
          </div>
        </section>

        <section className="module-panel response-detail">
          {selected && !detailLoading ? (
            <>
              <header>
                <div className="response-detail-title">
                  <small>{displayReference('SIM', selected.id)}</small>
                  <h3>{meta.label}</h3>
                  <p><span>Simulation target</span><strong>{selected.target_value || 'Unavailable'}</strong></p>
                </div>
                <span className={`response-state ${selected.state}`}>{stateLabel(selected.state)}</span>
              </header>

              <section className="response-test-summary">
                <div><small>Question being tested</small><strong>{meta.intent}</strong></div>
                <div><small>Simulated outcome</small><strong>{intendedEffect}</strong></div>
                <p><LockKeyhole /> This outcome exists only in BMB. External side effects are disabled.</p>
              </section>

              <dl className="response-facts">
                <div><dt>Proposed by</dt><dd><UserCheck />{detail?.requested_by || selected.requested_by || 'Not recorded'}</dd></div>
                <div><dt>Approved and activated by</dt><dd><UserCheck />{selected.executed_by || 'Not recorded'}</dd></div>
                <div><dt>Activated</dt><dd><Clock3 />{fmtTs(selected.executed_at)}</dd></div>
                <div><dt>Ledger verified</dt><dd><CheckCircle2 />{fmtTs(selected.verified_at)}</dd></div>
              </dl>

              <section className="response-reason">
                <small>Why this rehearsal was requested</small>
                <p>{detail?.reason || selected.reason || 'No proposal rationale was stored.'}</p>
              </section>

              <section className="response-evidence">
                <div><strong>Evidence used for this decision</strong><span>{(selected.evidence_alert_ids || []).length} linked alerts</span></div>
                <p>Open an alert to verify that it identifies the same {meta.subject} before trusting the recommendation.</p>
                <div className="response-evidence-links">
                  {(selected.evidence_alert_ids || []).map(id => (
                    <button type="button" key={id} onClick={() => navigate(`/alerts?search=${encodeURIComponent(id)}`)}>
                      <code>{alertReference(id)}</code><ArrowRight />
                    </button>
                  ))}
                  {!selected.evidence_alert_ids?.length && <span>No linked alert evidence was recorded.</span>}
                </div>
              </section>

              <section className={`response-verification ${detail?.verification?.verified ? 'verified' : 'unavailable'}`}>
                {detail?.verification?.verified ? <CheckCircle2 /> : <Info />}
                <div>
                  <strong>{detail?.verification?.verified ? 'Simulation ledger verified' : 'Ledger verification unavailable'}</strong>
                  <span>{detail?.verification?.verified
                    ? `${detail.verification.observed_state} state confirmed; external side effects remain false.`
                    : 'The stored record does not contain a completed verification result.'}</span>
                </div>
              </section>

              {detail?.events?.length > 0 && (
                <section className="response-events">
                  <div><strong>Audit timeline</strong><span>{detail.events.length} recorded events</span></div>
                  {detail.events.map(event => (
                    <article key={event.id}>
                      <i />
                      <div><strong>{String(event.event_type || 'event').replaceAll('_', ' ')}</strong><small>{event.actor || 'System'}</small></div>
                      <time>{fmtTs(event.created_at)}</time>
                    </article>
                  ))}
                </section>
              )}

              {selected.state === 'active' ? (
                <section className="response-rollback">
                  <div className="response-rollback-heading">
                    <span><RotateCcw /></span>
                    <div><strong>Close this rehearsal</strong><small>Request a separately approved rollback of the BMB simulation state.</small></div>
                  </div>
                  <label>Reason for closing the rehearsal<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="Document what was validated and why the rehearsal can be reverted." /></label>
                  <footer>
                    <small>Submitting creates a pending request. It does not immediately change even the simulated state.</small>
                    <button type="button" disabled={!reason.trim() || saving} onClick={requestRollback}><RotateCcw />{saving ? 'Submitting…' : 'Request rollback approval'}</button>
                  </footer>
                </section>
              ) : (
                <section className="response-closed"><CheckCircle2 /><div><strong>Rehearsal completed</strong><span>The simulation was reverted in the BMB ledger. No production system was changed.</span></div></section>
              )}
            </>
          ) : selected && detailLoading ? <DetailLoading /> : (
            <div className="module-empty">
              <ShieldOff />
              <strong>{error ? 'Simulation data unavailable' : 'Select a response rehearsal'}</strong>
              <span>{error ? 'Retry loading before reviewing evidence.' : 'Choose a record to inspect its purpose, evidence, verification, and rollback history.'}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
