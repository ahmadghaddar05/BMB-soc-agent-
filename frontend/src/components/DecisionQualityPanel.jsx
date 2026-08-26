import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronRight,
  CircleHelp, RefreshCw, ShieldCheck, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, fmtTs, sevClass } from '../lib/api';

const DECISION_LABELS = {
  confirmed:'Confirmed',
  challenged:'Challenged',
  needs_more_evidence:'More evidence required',
};

function metric(value, suffix = '') {
  return value == null ? 'Not available' : `${value}${suffix}`;
}

export default function DecisionQualityPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api(`/workflow-quality?days=${days}`));
    } catch (loadError) {
      setError(loadError.message || 'Decision quality could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  const maximumActivity = useMemo(
    () => Math.max(1, ...(data?.review_activity || []).map(item => Number(item.reviews) || 0)),
    [data]
  );

  function openEntity(review) {
    setOpen(false);
    if (review.entity_type === 'incident') navigate(`/incidents?incident=${encodeURIComponent(review.entity_id)}`);
    else navigate(`/alerts?search=${encodeURIComponent(review.entity_id)}`);
  }

  return (
    <>
      <button
        type="button"
        className="decision-quality-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open decision assurance"
      >
        <ShieldCheck />
        <span>Decision assurance</span>
        <strong>
          {loading ? 'Loading' : data?.summary?.review_coverage_percent == null
            ? 'No baseline'
            : `${data.summary.review_coverage_percent}% reviewed`}
        </strong>
      </button>

      {open && (
        <div className="decision-quality-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="decision-quality-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-quality-title">
            <header>
              <div>
                <span><BarChart3 />Human assurance</span>
                <h2 id="decision-quality-title">AI decision quality review</h2>
                <p>Measured analyst agreement and review coverage for stored triage and incident decisions.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close decision assurance"><X /></button>
            </header>

            <div className="decision-quality-controls">
              <div role="group" aria-label="Decision quality period">
                {[7,30,90].map(value => (
                  <button key={value} type="button" className={days === value ? 'active' : ''} onClick={() => setDays(value)}>
                    {value} days
                  </button>
                ))}
              </div>
              <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button>
            </div>

            {error ? (
              <div className="decision-quality-error"><AlertTriangle /><strong>Quality data unavailable</strong><span>{error}</span></div>
            ) : loading && !data ? (
              <div className="decision-quality-loading">Loading stored review evidence…</div>
            ) : (
              <>
                <div className="decision-quality-trust">
                  <CircleHelp />
                  <p><strong>Agreement is not accuracy.</strong> {data?.methodology?.description}</p>
                </div>

                <div className="decision-quality-metrics">
                  <article><span>Machine decisions</span><strong>{data?.summary?.machine_decisions ?? 0}</strong><small>Completed within this period</small></article>
                  <article><span>Review coverage</span><strong>{metric(data?.summary?.review_coverage_percent, '%')}</strong><small>{data?.summary?.reviewed ?? 0} reviewed · {data?.summary?.awaiting_review ?? 0} awaiting</small></article>
                  <article><span>Analyst agreement</span><strong>{metric(data?.summary?.analyst_agreement_percent, '%')}</strong><small>Confirmed ÷ reviewed decisions</small></article>
                  <article className="attention"><span>Attention required</span><strong>{(data?.summary?.challenged || 0) + (data?.summary?.needs_more_evidence || 0)}</strong><small>{data?.summary?.challenged || 0} challenged · {data?.summary?.needs_more_evidence || 0} need evidence</small></article>
                </div>

                <div className="decision-quality-grid">
                  <section>
                    <div className="decision-quality-section-title">
                      <div><span>Coverage by workflow</span><strong>Where human review exists</strong></div>
                    </div>
                    <div className="decision-quality-scopes">
                      {Object.entries(data?.scopes || {}).map(([key, scope]) => (
                        <article key={key}>
                          <div><strong>{key === 'alerts' ? 'Alert triage' : 'Incident decisions'}</strong><span>{metric(scope.review_coverage_percent, '%')} reviewed</span></div>
                          <div className="quality-progress"><i style={{ width:`${Math.min(100, scope.review_coverage_percent || 0)}%` }} /></div>
                          <dl>
                            <div><dt>Decisions</dt><dd>{scope.machine_decisions}</dd></div>
                            <div><dt>Confirmed</dt><dd>{scope.confirmed}</dd></div>
                            <div><dt>Challenged</dt><dd>{scope.challenged}</dd></div>
                            <div><dt>Need evidence</dt><dd>{scope.needs_more_evidence}</dd></div>
                          </dl>
                        </article>
                      ))}
                    </div>

                    <div className="decision-quality-section-title activity">
                      <div><span>Review activity</span><strong>Human decisions recorded over time</strong></div>
                    </div>
                    <div className="decision-quality-trend" aria-label="Analyst review activity by day">
                      {(data?.review_activity || []).length ? data.review_activity.map(item => (
                        <div key={item.day}>
                          <time>{new Date(`${item.day}T00:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric' })}</time>
                          <span><i style={{ width:`${Math.max(4, ((Number(item.reviews) || 0) / maximumActivity) * 100)}%` }} /></span>
                          <strong>{item.reviews}</strong>
                        </div>
                      )) : <p>No analyst reviews were recorded in this period.</p>}
                    </div>
                  </section>

                  <section>
                    <div className="decision-quality-section-title">
                      <div><span>Recent human reviews</span><strong>Latest append-only decisions</strong></div>
                      <small>{data?.recent_reviews?.length || 0} shown</small>
                    </div>
                    <div className="decision-quality-reviews">
                      {(data?.recent_reviews || []).length ? data.recent_reviews.map(review => (
                        <button key={review.id} type="button" onClick={() => openEntity(review)}>
                          <span className={`quality-review-state ${review.decision}`}>
                            {review.decision === 'confirmed' ? <CheckCircle2 /> : review.decision === 'challenged' ? <AlertTriangle /> : <CircleHelp />}
                          </span>
                          <span>
                            <strong>{review.title}</strong>
                            <small>{DECISION_LABELS[review.decision] || review.decision} by {review.actor} · {fmtTs(review.created_at)}</small>
                            <p>{review.reason}</p>
                          </span>
                          <em className={`badge ${sevClass(review.severity)}`}>{review.severity}</em>
                          <ChevronRight />
                        </button>
                      )) : <p className="decision-quality-empty">No reviews have been recorded in this period.</p>}
                    </div>
                  </section>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
