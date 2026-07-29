import { useState } from 'react';
import { AlertTriangle, Check, CircleHelp, MessageSquareWarning, ShieldCheck } from 'lucide-react';
import { api, fmtTs } from '../lib/api';

const OPTIONS = [
  { value:'confirmed', label:'Confirm', icon:Check, help:'Stored evidence supports this decision.' },
  { value:'challenged', label:'Challenge', icon:MessageSquareWarning, help:'The decision appears incorrect or overstated.' },
  { value:'needs_more_evidence', label:'Need evidence', icon:CircleHelp, help:'The current evidence is insufficient.' },
];

function decisionLabel(value) {
  return OPTIONS.find(option => option.value === value)?.label || String(value || '').replaceAll('_', ' ');
}

export default function AnalystDecisionReview({ entityType, entityId, reviews = [], onRecorded }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState('confirmed');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = reviews[0];

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api('/workflow-reviews', {
        method:'POST',
        body:JSON.stringify({
          entity_type:entityType,
          entity_id:String(entityId),
          decision,
          reason:reason.trim(),
        }),
      });
      onRecorded?.(result.review);
      setReason('');
      setOpen(false);
    } catch (reviewError) {
      setError(reviewError.message || 'The analyst review could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="analyst-decision-review" aria-labelledby={`${entityType}-${entityId}-review-title`}>
      <div className="analyst-review-summary">
        <span className={`analyst-review-icon ${latest?.decision || 'unreviewed'}`}><ShieldCheck /></span>
        <div>
          <span>Human review</span>
          <strong id={`${entityType}-${entityId}-review-title`}>
            {latest ? `${decisionLabel(latest.decision)} by ${latest.actor}` : 'No analyst decision recorded'}
          </strong>
          <small>
            {latest
              ? `${latest.reason} · ${fmtTs(latest.created_at)}`
              : 'Confirm, challenge, or request more evidence. The AI record remains unchanged.'}
          </small>
        </div>
        <button type="button" onClick={() => setOpen(value => !value)}>
          {open ? 'Cancel review' : latest ? 'Add new review' : 'Record review'}
        </button>
      </div>

      {open && (
        <form onSubmit={submit}>
          <fieldset>
            <legend>Analyst decision</legend>
            <div>
              {OPTIONS.map(option => {
                const Icon = option.icon;
                return (
                  <label key={option.value} className={decision === option.value ? 'selected' : ''}>
                    <input
                      type="radio"
                      name={`${entityType}-${entityId}-decision`}
                      value={option.value}
                      checked={decision === option.value}
                      onChange={() => setDecision(option.value)}
                    />
                    <Icon />
                    <span><strong>{option.label}</strong><small>{option.help}</small></span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="analyst-review-reason">
            Reason
            <textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              minLength={10}
              maxLength={1000}
              rows={3}
              placeholder="State which evidence supports your review or what is missing…"
              required
            />
            <small>{reason.trim().length}/1000 · minimum 10 characters</small>
          </label>
          {error && <p className="analyst-review-error" role="alert"><AlertTriangle />{error}</p>}
          <div className="analyst-review-actions">
            <p>Append-only review. This does not rewrite the AI verdict or execute a response.</p>
            <button type="submit" disabled={busy || reason.trim().length < 10}>
              {busy ? 'Recording…' : 'Record analyst review'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
