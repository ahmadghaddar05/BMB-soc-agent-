import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, BriefcaseBusiness, FileText, MessageSquareText, ShieldAlert,
} from 'lucide-react';
import { api, fmtTs } from '../lib/api';
import { relativeTime } from '../lib/soc';
import { friendlyEvidenceText } from '../lib/executive';
import {
  Button, Card, EmptyState, Select, SeverityBadge, SkeletonLoader, StatusChip, Timeline,
} from '../components/ui';

const OWNER_OPTIONS = ['SOC Analyst', 'Incident Lead', 'Shift Lead'];

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function caseReference(id) {
  return `CASE-${String(id).padStart(6, '0')}`;
}

function statusLabel(status) {
  if (status === 'false_positive') return 'False positive';
  return status === 'closed' ? 'Closed' : 'Open';
}

function statusTone(status) {
  return status === 'open' ? 'active' : 'resolved';
}

function nextAction(item) {
  if (!item.owner) return 'Assign an accountable owner';
  if (!item.notes?.length) return 'Record findings and supporting evidence';
  if (item.status === 'open') return 'Document the next case decision';
  return 'Review the closure record';
}

export default function Cases() {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const detailRequest = useRef(0);

  const openCase = useCallback(async id => {
    const requestId = ++detailRequest.current;
    setSelectedId(id);
    setSelected(null);
    setDetailLoading(true);
    setError('');
    try {
      const detail = await api(`/cases/${id}`);
      if (detailRequest.current === requestId) setSelected(detail);
    } catch (requestError) {
      if (detailRequest.current === requestId) setError(requestError.message || 'Case details could not be loaded.');
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    api('/cases?limit=100').then(data => {
      if (!mounted) return;
      const items = data.cases || [];
      setCases(items);
      if (items[0]) openCase(items[0].id);
    }).catch(loadError => {
      if (mounted) setError(loadError.message || 'Cases could not be loaded.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [openCase]);

  const counts = useMemo(() => ({
    critical:cases.filter(item => normalized(item.severity) === 'critical' && normalized(item.status) === 'open').length,
    open:cases.filter(item => normalized(item.status) === 'open').length,
    closed:cases.filter(item => ['closed', 'false_positive'].includes(normalized(item.status))).length,
    assigned:cases.filter(item => Boolean(item.owner)).length,
  }), [cases]);

  const timelineItems = useMemo(() => (selected?.notes || []).map(item => ({
    id:item.id,
    icon:<MessageSquareText aria-hidden="true" />,
    title:item.author || 'SOC analyst',
    detail:friendlyEvidenceText(item.body),
    meta:relativeTime(item.created_at),
  })), [selected?.notes]);

  async function updateCase(changes) {
    if (!selected) return;
    if (['closed', 'false_positive'].includes(changes.status) && !selected.notes?.length) {
      setError('Add a case note with supporting evidence before closing this case.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await api(`/cases/${selected.id}`, { method:'PATCH', body:JSON.stringify(changes) });
      setSelected(current => ({ ...current, ...updated }));
      setCases(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (updateError) {
      setError(updateError.message || 'The case could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event) {
    event.preventDefault();
    if (!selected || !note.trim()) return;
    setSaving(true);
    setError('');
    try {
      const added = await api(`/cases/${selected.id}/notes`, { method:'POST', body:JSON.stringify({ body:note.trim() }) });
      setSelected(current => ({ ...current, notes:[added, ...(current.notes || [])], updated_at:added.created_at }));
      setCases(current => current.map(item => item.id === selected.id
        ? { ...item, note_count:Number(item.note_count || 0) + 1, updated_at:added.created_at }
        : item));
      setNote('');
    } catch (noteError) {
      setError(noteError.message || 'The case note could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const ownerOptions = selected?.owner && !OWNER_OPTIONS.includes(selected.owner)
    ? [selected.owner, ...OWNER_OPTIONS]
    : OWNER_OPTIONS;

  return (
    <div className="cases-page-v2 ui-page-enter">
      <section className="cases-kpi-strip" aria-label="Case summary">
        <article><small>Critical open</small><strong>{counts.critical}</strong></article>
        <article><small>Open</small><strong>{counts.open}</strong></article>
        <article><small>Closed</small><strong>{counts.closed}</strong></article>
        <article><small>Assigned</small><strong>{counts.assigned}</strong></article>
      </section>

      {error && (
        <div className="cases-error" role="alert">
          <ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss case error">Dismiss</button>
        </div>
      )}

      <div className="cases-layout-v2">
        <Card
          compact
          className="cases-list-panel"
          title="Case queue"
          caption="Durable ownership and analyst record"
          action={<StatusChip status={counts.open ? 'active' : 'neutral'}>{counts.open} open</StatusChip>}
        >
          {loading ? (
            <div className="cases-list-loading"><SkeletonLoader lines={6} /></div>
          ) : cases.length ? (
            <ol className="cases-queue-v2" aria-label="Security cases">
              {cases.map(item => {
                const isSelected = String(selectedId) === String(item.id);
                const severity = normalized(item.severity) || 'low';
                return (
                  <li key={item.id} className={`is-${severity}`}>
                    <button type="button" onClick={() => openCase(item.id)} className={isSelected ? 'is-selected' : ''} aria-current={isSelected ? 'true' : undefined}>
                      <span className="cases-row-heading">
                        <code>{caseReference(item.id)}</code>
                        <SeverityBadge severity={severity} />
                      </span>
                      <strong>{item.title || 'Untitled security case'}</strong>
                      <small>{item.alert_ids?.length || 0} alerts · {item.note_count || 0} notes · {relativeTime(item.updated_at || item.last_seen)}</small>
                      <StatusChip status={statusTone(item.status)}>{statusLabel(item.status)}</StatusChip>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState icon={BriefcaseBusiness} message="No cases available" />
          )}
        </Card>

        <div className="cases-detail-stack">
          {detailLoading && (
            <Card className="cases-detail-loading"><SkeletonLoader lines={6} /></Card>
          )}

          {!detailLoading && selected && (
            <>
              <Card className="cases-detail-card">
                <header className="cases-detail-header">
                  <div>
                    <div className="cases-detail-reference"><code>{caseReference(selected.id)}</code><SeverityBadge severity={selected.severity} /></div>
                    <h2>{selected.title || 'Untitled security case'}</h2>
                    <p>{selected.narrative || 'This case is ready for analyst findings and ownership.'}</p>
                  </div>
                  <div className="cases-detail-actions">
                    <Button icon={ArrowUpRight} onClick={() => navigate(`/incidents?incident=${encodeURIComponent(selected.id)}`)}>Open incident</Button>
                    <Button as="a" href={`/api/reports/incidents/${selected.id}`} icon={FileText}>Generate report</Button>
                  </div>
                </header>

                <div className="case-form cases-inline-controls" aria-label="Editable case fields">
                  <Select label="Owner" value={selected.owner || ''} disabled={saving} onChange={event => updateCase({ owner:event.target.value })}>
                    <option value="">Unassigned</option>
                    {ownerOptions.map(owner => <option key={owner} value={owner}>{owner}</option>)}
                  </Select>
                  <Select label="Status" value={selected.status || 'open'} disabled={saving} onChange={event => updateCase({ status:event.target.value })}>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="false_positive">False positive</option>
                  </Select>
                </div>

                <dl className="cases-fact-grid">
                  <div><dt>First observed</dt><dd title={fmtTs(selected.first_seen)}>{relativeTime(selected.first_seen)}</dd></div>
                  <div><dt>Last activity</dt><dd title={fmtTs(selected.last_seen)}>{relativeTime(selected.last_seen)}</dd></div>
                  <div><dt>First response</dt><dd>{selected.first_response_at ? relativeTime(selected.first_response_at) : 'Awaiting response'}</dd></div>
                  <div><dt>Evidence</dt><dd>{selected.alert_ids?.length || 0} linked alerts</dd></div>
                </dl>

                <div className="cases-next-action">
                  <span>Next action</span>
                  <strong>{nextAction(selected)}</strong>
                </div>
              </Card>

              <Card
                className="cases-timeline-card"
                title="Analyst timeline"
                caption="Human findings, decisions, and supporting evidence"
                action={<StatusChip status={timelineItems.length ? 'active' : 'neutral'}>{timelineItems.length} notes</StatusChip>}
              >
                {timelineItems.length
                  ? <Timeline items={timelineItems} className="cases-analyst-timeline" />
                  : <EmptyState icon={MessageSquareText} message="No analyst notes yet" />}
                <form className="cases-note-composer" onSubmit={addNote}>
                  <label htmlFor="case-note">Record evidence or a decision</label>
                  <textarea id="case-note" value={note} onChange={event => setNote(event.target.value)} placeholder="Add a concise finding, decision, or next action" maxLength={4000} />
                  <div><small>{note.length.toLocaleString()} / 4,000</small><Button type="submit" variant="primary" disabled={!note.trim() || saving}>{saving ? 'Saving…' : 'Add note'}</Button></div>
                </form>
              </Card>
            </>
          )}

          {!loading && !detailLoading && !selected && (
            <Card><EmptyState icon={BriefcaseBusiness} message="Select a case to review" /></Card>
          )}
        </div>
      </div>
    </div>
  );
}
