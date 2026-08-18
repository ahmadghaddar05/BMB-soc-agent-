import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, BellOff, ChevronDown, ChevronUp, Clock3,
  Crosshair, Database, FileSearch, Pause, Play, RefreshCw, Server, ShieldCheck, User,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  activityTitle, alertReference, businessAssetLabel, humanize, severityOf,
} from '../lib/executive';
import {
  Button, EmptyState, LiveIndicator, SegmentedControl, Select, SeverityBadge,
  SkeletonLoader, StatusChip,
} from '../components/ui';

const REFRESH_INTERVAL_MS = 15_000;
const PAGE_SIZE = 100;
const TIME_RANGES = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

function activityId(activity) {
  return activity.id || activity.representative_alert_id || activity.group_key;
}

function representativeId(activity) {
  return activity.representative_alert_id || activity.id || '';
}

function activityTimestamp(activity) {
  return activity.last_seen || activity.timestamp || activity.first_seen;
}

function activitySignature(activity) {
  return `${activityTimestamp(activity) || ''}:${activity.triage_status || 'pending'}`;
}

function sourceLabel(activity) {
  return activity.source_system || activity.event_dataset || activity.decoder || activity.agent_name || 'Unknown source';
}

function datasetLabel(activity) {
  return activity.event_dataset || activity.decoder || activity.source_system || 'Unknown dataset';
}

function formatTimestamp(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return date.toLocaleString([], {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function relativeTimestamp(value) {
  if (!value) return 'Unknown';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return `${Math.max(1, Math.floor(elapsed / 1000))}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function aiState(activity) {
  const status = String(activity.triage_status || 'pending').toLowerCase();
  const verdict = String(activity.verdict || '').toLowerCase();
  if (status === 'triage_failed') return { label:'AI failed', tone:'error' };
  if (status === 'pending') return { label:'Pending', tone:'neutral' };
  if (verdict === 'needs_investigation' || verdict === 'true_positive') {
    return { label:humanize(verdict), tone:'attention' };
  }
  if (verdict === 'false_positive' || verdict === 'benign_anomaly') {
    return { label:humanize(verdict), tone:'resolved' };
  }
  if (status === 'triaged') return { label:'Triaged', tone:'active' };
  return { label:humanize(status), tone:'neutral' };
}

function buildSignatureMap(activities) {
  return new Map(activities.map(activity => [activityId(activity), activitySignature(activity)]));
}

export default function LiveMonitoring() {
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [collector, setCollector] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [collectorError, setCollectorError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [bufferedActivities, setBufferedActivities] = useState(null);
  const [bufferedTotal, setBufferedTotal] = useState(0);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [viewUpdatedAt, setViewUpdatedAt] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [viewMode, setViewMode] = useState('grouped');
  const [filters, setFilters] = useState({ severity:'all', source:'all', time:'24h' });
  const [mutedIds, setMutedIds] = useState(() => new Set());
  const [page, setPage] = useState(1);

  const pausedRef = useRef(false);
  const mountedRef = useRef(false);
  const refreshingRef = useRef(false);
  const displayedSignaturesRef = useRef(new Map());
  const bufferedSignaturesRef = useRef(new Set());

  function commitActivities(nextActivities, nextTotal, updatedAt = new Date()) {
    setActivities(nextActivities);
    setTotal(nextTotal);
    setViewUpdatedAt(updatedAt);
    displayedSignaturesRef.current = buildSignatureMap(nextActivities);
  }

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (mountedRef.current) setRefreshing(true);

    try {
      const rangeQuery = filters.time !== 'all'
        ? `&from=${encodeURIComponent(new Date(Date.now() - TIME_RANGES[filters.time]).toISOString())}`
        : '';
      const activityPath = viewMode === 'grouped'
        ? `/alert-groups?page=${page}&limit=${PAGE_SIZE}`
        : `/alerts?page=${page}&limit=${PAGE_SIZE}`;
      const [activityResult, collectorResult] = await Promise.allSettled([
        api(`${activityPath}${rangeQuery}`),
        api('/collector/status'),
      ]);
      if (!mountedRef.current) return;

      if (activityResult.status === 'rejected') throw activityResult.reason;
      const activityData = activityResult.value;
      const collectorData = collectorResult.status === 'fulfilled' ? collectorResult.value : null;
      const nextActivities = viewMode === 'grouped'
        ? activityData.groups || []
        : activityData.alerts || [];
      const checkedAt = new Date();

      if (collectorData) setCollector(collectorData);
      setCollectorError(collectorResult.status === 'rejected'
        ? collectorResult.reason?.message || 'Collector status is unavailable.'
        : null);
      setLastCheckedAt(checkedAt);
      setError(null);

      if (pausedRef.current) {
        const baseline = displayedSignaturesRef.current;
        nextActivities.forEach(activity => {
          const id = activityId(activity);
          const signature = activitySignature(activity);
          if (!baseline.has(id) || baseline.get(id) !== signature) {
            bufferedSignaturesRef.current.add(`${id}:${signature}`);
          }
        });
        setBufferedActivities(nextActivities);
        setBufferedTotal(Number(activityData.total || nextActivities.length));
        setBufferedCount(bufferedSignaturesRef.current.size);
      } else {
        commitActivities(nextActivities, Number(activityData.total || nextActivities.length), checkedAt);
      }
    } catch (refreshError) {
      if (mountedRef.current) setError(refreshError.message || 'Monitoring data could not be refreshed.');
    } finally {
      refreshingRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filters.time, page, viewMode]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const refreshWhenVisible = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  const sources = useMemo(() => (
    [...new Set(activities.map(sourceLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  ), [activities]);

  const filteredActivities = useMemo(() => {
    const now = Date.now();
    return activities.filter(activity => {
      const id = activityId(activity);
      if (mutedIds.has(id)) return false;
      if (filters.severity !== 'all' && severityOf(activity) !== filters.severity) return false;
      if (filters.source !== 'all' && sourceLabel(activity) !== filters.source) return false;
      if (filters.time !== 'all') {
        const timestamp = new Date(activityTimestamp(activity)).getTime();
        if (!Number.isFinite(timestamp) || timestamp < now - TIME_RANGES[filters.time]) return false;
      }
      return true;
    });
  }, [activities, filters, mutedIds]);

  const collectorState = useMemo(() => {
    const status = collector?.collector || {};
    const source = humanize(status.source || 'elastic');
    if (status.collection_active) return { label:`Receiving ${source} alerts`, live:true };
    if (status.live_collection_enabled && status.live_collection_running) {
      return { label:`${source} live ingest active`, live:true };
    }
    if (status.cycle_active) return { label:'Processing stored alerts', live:true };
    if (status.scheduler_enabled && status.scheduler_running) return { label:'AI processing scheduled', tone:'attention' };
    if (collector) return { label:'Live ingest stopped', tone:'attention' };
    return { label:'Checking collector', tone:'neutral' };
  }, [collector]);

  const hasFilters = filters.severity !== 'all' || filters.source !== 'all' || filters.time !== '24h';

  function pauseUpdates() {
    pausedRef.current = true;
    bufferedSignaturesRef.current = new Set();
    setBufferedActivities(null);
    setBufferedTotal(0);
    setBufferedCount(0);
    setPaused(true);
  }

  function resumeUpdates() {
    const resumedAt = new Date();
    pausedRef.current = false;
    if (bufferedActivities) commitActivities(bufferedActivities, bufferedTotal, lastCheckedAt || resumedAt);
    bufferedSignaturesRef.current = new Set();
    setBufferedActivities(null);
    setBufferedTotal(0);
    setBufferedCount(0);
    setPaused(false);
  }

  function muteActivity(id) {
    setExpandedId(current => current === id ? null : current);
    setMutedIds(current => new Set([...current, id]));
  }

  function clearFilters() {
    setFilters({ severity:'all', source:'all', time:'24h' });
    setPage(1);
  }

  return (
    <section className="monitoring-page ui-page-enter" aria-label="Live security activity">
      <div className="monitoring-command-bar">
        <div className="monitoring-state">
          {paused
            ? <StatusChip status="attention">Paused</StatusChip>
            : collectorState.live
              ? <LiveIndicator label={collectorState.label} />
              : <StatusChip status={collectorState.tone}>{collectorState.label}</StatusChip>}
          <span>{filteredActivities.length.toLocaleString()} visible</span>
          {mutedIds.size > 0 && (
            <button type="button" onClick={() => setMutedIds(new Set())}>
              Restore {mutedIds.size.toLocaleString()} muted
            </button>
          )}
        </div>
        <div className="monitoring-refresh-controls">
          <Clock3 size={16} strokeWidth={1.5} aria-hidden="true" />
          <time dateTime={lastCheckedAt?.toISOString()}>
            {paused
              ? `Paused${viewUpdatedAt ? ` at ${viewUpdatedAt.toLocaleTimeString()}` : ''}`
              : lastCheckedAt ? `Updated ${lastCheckedAt.toLocaleTimeString()}` : 'Awaiting first refresh'}
          </time>
          <Button variant="secondary" icon={paused ? Play : Pause} onClick={paused ? resumeUpdates : pauseUpdates}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button icon={RefreshCw} iconOnly onClick={refresh} disabled={refreshing} aria-label="Refresh monitoring data" title="Refresh monitoring data" />
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {paused && bufferedCount ? `${bufferedCount} new alert update${bufferedCount === 1 ? '' : 's'} since pause.` : ''}
      </p>

      {paused && (
        <div className="monitoring-pause-notice" role="status">
          <span>{bufferedCount
            ? `${bufferedCount} new alert update${bufferedCount === 1 ? '' : 's'} since pause`
            : 'Monitoring is paused; no new alerts are waiting'}</span>
          {bufferedCount > 0 && <button type="button" onClick={resumeUpdates}>Resume and show</button>}
        </div>
      )}

      {(error || collectorError) && (
        <div className={`monitoring-inline-alert ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>
          <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>{error || `Alerts are live; collector health is unavailable. ${collectorError}`}</span>
        </div>
      )}

      <div className="monitoring-filter-bar" id="monitoring-filters">
        <SegmentedControl
          label="Monitoring record view"
          value={viewMode}
          options={[
            { value:'grouped', label:'Grouped' },
            { value:'individual', label:'Individual' },
          ]}
          onChange={value => {
            setViewMode(value);
            setPage(1);
            setExpandedId(null);
          }}
        />
        <div className="monitoring-filter-controls">
          <Select aria-label="Filter by severity" value={filters.severity} onChange={event => { setFilters(current => ({ ...current, severity:event.target.value })); setPage(1); }}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Select aria-label="Filter by source" value={filters.source} onChange={event => { setFilters(current => ({ ...current, source:event.target.value })); setPage(1); }}>
            <option value="all">All sources</option>
            {sources.map(source => <option value={source} key={source}>{humanize(source)}</option>)}
          </Select>
          <Select aria-label="Filter by time range" value={filters.time} onChange={event => { setFilters(current => ({ ...current, time:event.target.value })); setPage(1); }}>
            <option value="15m">Last 15 minutes</option>
            <option value="1h">Last hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="all">All loaded</option>
          </Select>
        </div>
        <div className="monitoring-filter-summary">
          <span>{filteredActivities.length.toLocaleString()} results</span>
          {hasFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}
        </div>
      </div>

      <div className="monitoring-feed-card">
        {loading ? (
          <div className="monitoring-skeleton" aria-label="Loading monitoring activities">
            {[0, 1, 2, 3, 4].map(item => <SkeletonLoader key={item} lines={2} />)}
          </div>
        ) : filteredActivities.length ? (
          <ol className="monitoring-feed" aria-label={`${viewMode === 'grouped' ? 'Grouped' : 'Individual'} security activity`}>
            {filteredActivities.map(activity => {
              const id = activityId(activity);
              return (
                <ActivityItem
                  key={id}
                  activity={activity}
                  id={id}
                  technicalId={representativeId(activity)}
                  expanded={expandedId === id}
                  onToggle={() => setExpandedId(current => current === id ? null : id)}
                  onMute={() => muteActivity(id)}
                />
              );
            })}
          </ol>
        ) : (
          <EmptyState
            icon={ShieldCheck}
            message="No alerts in this view"
            action={(hasFilters || mutedIds.size > 0) ? <button type="button" onClick={() => { clearFilters(); setMutedIds(new Set()); }}>Reset view</button> : null}
          />
        )}

        <footer className="monitoring-pagination">
          <span>{total
            ? `${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * PAGE_SIZE, total).toLocaleString()} of ${total.toLocaleString()}`
            : '0 alerts'}</span>
          <div>
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</Button>
            <span>Page {page}</span>
            <Button variant="secondary" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(value => value + 1)}>Next</Button>
          </div>
        </footer>
      </div>
    </section>
  );
}

function ActivityItem({ activity, id, technicalId, expanded, onToggle, onMute }) {
  const title = activityTitle(activity);
  const timestamp = activityTimestamp(activity);
  const severity = severityOf(activity);
  const state = aiState(activity);
  const triageTarget = technicalId
    ? `/alerts?time_range=all&search=${encodeURIComponent(technicalId)}`
    : '/alerts?time_range=all';
  const investigationTarget = `/investigations?search=${encodeURIComponent(technicalId || alertReference(activity))}`;
  const replayTarget = technicalId
    ? `/attack-simulator?alert=${encodeURIComponent(technicalId)}&autoplay=1`
    : '/attack-simulator';
  const domId = `monitoring-details-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <li className={`monitoring-feed-item ${expanded ? 'is-expanded' : ''}`}>
      <span className={`monitoring-feed-marker is-${severity}`} aria-hidden="true"><Activity size={16} strokeWidth={1.5} /></span>
      <button
        type="button"
        className="monitoring-row-main"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={domId}
      >
        <span className="monitoring-detection">
          <span>
            <strong>{title}</strong>
            {Number(activity.occurrence_count || 0) > 1 && (
              <StatusChip status="active">{Number(activity.occurrence_count).toLocaleString()} matches</StatusChip>
            )}
          </span>
          <code>{alertReference(activity)}</code>
        </span>
        <SeverityBadge severity={severity} />
        <span className="monitoring-asset">
          <strong>{businessAssetLabel(activity)}</strong>
          <small>{activity.username || activity.hostname || 'Entity unresolved'}</small>
        </span>
        <span className="monitoring-source">{humanize(sourceLabel(activity))}</span>
        <time className="monitoring-time" dateTime={timestamp || undefined} title={formatTimestamp(timestamp)}>{relativeTimestamp(timestamp)}</time>
        <StatusChip status={state.tone}>{state.label}</StatusChip>
        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </button>

      <div className="monitoring-row-actions" aria-label={`Actions for ${title}`}>
        <Link to={replayTarget} className="monitoring-row-action" aria-label={`Run animated replay for ${title}`} title="Run alert replay">
          <Crosshair size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <Link to={triageTarget} className="monitoring-row-action" aria-label={`Open ${title} in technical triage`} title="Open technical triage">
          <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <Link to={investigationTarget} className="monitoring-row-action" aria-label={`Investigate ${title}`} title="Build investigation">
          <FileSearch size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <button type="button" className="monitoring-row-action" onClick={onMute} aria-label={`Mute ${title} from this view`} title="Mute from this view">
          <BellOff size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <div id={domId} className="monitoring-row-details">
          <dl>
            <Detail icon={Server} label="Host" value={activity.hostname || activity.agent_name || 'Unresolved'} />
            <Detail icon={User} label="Identity" value={activity.username || 'Unresolved'} />
            <Detail icon={Database} label="Dataset" value={datasetLabel(activity)} />
            <Detail label="Detection action" value={activity.event_action || activity.alert_reason || title} />
            <Detail label="Source address" value={activity.src_ip || 'Unavailable'} />
            <Detail label="Destination address" value={activity.dst_ip || 'Unavailable'} />
            <Detail label="First observed" value={formatTimestamp(activity.first_seen || activity.timestamp)} />
            <Detail label="Last observed" value={formatTimestamp(timestamp)} />
          </dl>
          <div className="monitoring-details-actions">
            <Link to={replayTarget} className="monitoring-details-link">Run animated replay</Link>
            <Link to={triageTarget} className="monitoring-details-link is-secondary">Open technical triage</Link>
          </div>
        </div>
      )}
    </li>
  );
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div>
      <dt>{Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" />}{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
