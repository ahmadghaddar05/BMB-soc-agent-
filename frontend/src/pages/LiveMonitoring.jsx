import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ChevronDown, ChevronUp, Clock3, Database,
  Pause, Play, RefreshCw, Search, Server, ShieldCheck, User, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { activityTitle, alertReference, businessAssetLabel, humanize, severityOf } from '../lib/executive';

const REFRESH_INTERVAL_MS = 15_000;

const SEVERITY_STYLES = {
  critical: 'border-rose-400/35 bg-rose-400/10 text-rose-300',
  high: 'border-orange-400/35 bg-orange-400/10 text-orange-300',
  medium: 'border-amber-300/35 bg-amber-300/10 text-amber-200',
  low: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
};

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
  return activity.event_dataset || activity.decoder || activity.agent_name || 'Elastic';
}

function formatTimestamp(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return date.toLocaleString([], {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
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
  const [paused, setPaused] = useState(false);
  const [bufferedActivities, setBufferedActivities] = useState(null);
  const [bufferedTotal, setBufferedTotal] = useState(0);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [viewUpdatedAt, setViewUpdatedAt] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filters, setFilters] = useState({ severity: 'all', source: 'all', time: '24h', search: '' });
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
      const [activityData, collectorData] = await Promise.all([
        api(`/alerts?page=${page}&limit=100`),
        api('/collector/status'),
      ]);
      if (!mountedRef.current) return;

      const nextActivities = activityData.alerts || [];
      const checkedAt = new Date();
      setCollector(collectorData);
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
  }, [page]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const sources = useMemo(() => (
    [...new Set(activities.map(sourceLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  ), [activities]);

  const filteredActivities = useMemo(() => {
    const now = Date.now();
    const search = filters.search.trim().toLowerCase();
    return activities.filter(activity => {
      const severity = severityOf(activity);
      if (filters.severity !== 'all' && severity !== filters.severity) return false;
      if (filters.source !== 'all' && sourceLabel(activity) !== filters.source) return false;
      if (filters.time !== 'all') {
        const timestamp = new Date(activityTimestamp(activity)).getTime();
        if (!Number.isFinite(timestamp) || timestamp < now - TIME_RANGES[filters.time]) return false;
      }
      if (!search) return true;
      return [
        activityTitle(activity), businessAssetLabel(activity), representativeId(activity),
        activity.hostname, activity.username, activity.src_ip, activity.event_action,
        activity.alert_reason, sourceLabel(activity),
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(search));
    });
  }, [activities, filters]);

  const collectorState = useMemo(() => {
    const status = collector?.collector || {};
    if (status.cycle_active) return { label: 'Collection cycle active', tone: 'text-cyan-300', dot: 'bg-cyan-300' };
    if (status.scheduler_enabled && status.scheduler_running) {
      return { label: 'Collector scheduled', tone: 'text-emerald-300', dot: 'bg-emerald-300' };
    }
    if (collector) return { label: 'Collector paused', tone: 'text-amber-200', dot: 'bg-amber-300' };
    return { label: 'Checking collector', tone: 'text-slate-400', dot: 'bg-slate-500' };
  }, [collector]);

  const hasFilters = filters.severity !== 'all' || filters.source !== 'all' || filters.time !== '24h' || filters.search;

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

  return (
    <section className="live-monitoring-page min-h-full bg-[#07111b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8" aria-labelledby="live-monitoring-title">
      <header className="mx-auto flex max-w-[1600px] flex-col gap-4 border-b border-slate-700/50 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
            <Activity className="h-4 w-4" aria-hidden="true" />
            Operational visibility
          </div>
          <h2 id="live-monitoring-title" className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-[28px]">
            Live Monitoring
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Individual Elastic alert records in newest-first order, automatically refreshed every 15 seconds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={`inline-flex items-center gap-2 ${collectorState.tone}`}>
            <i className={`h-2 w-2 rounded-full ${collectorState.dot}`} aria-hidden="true" />
            {collectorState.label}
          </span>
          <span className="inline-flex items-center gap-2 text-slate-400">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            {paused
              ? `View paused${viewUpdatedAt ? ` at ${viewUpdatedAt.toLocaleTimeString()}` : ''}`
              : lastCheckedAt ? `Refreshed ${lastCheckedAt.toLocaleTimeString()}` : 'Awaiting first refresh'}
          </span>
          <button
            type="button"
            onClick={paused ? resumeUpdates : pauseUpdates}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-600/70 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 transition hover:border-cyan-400/50 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? 'Resume updates' : 'Pause updates'}
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh monitoring data now"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-600/70 bg-slate-900/60 text-slate-300 transition hover:border-cyan-400/50 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="mx-auto mt-5 max-w-[1600px]">
        <p className="sr-only" aria-live="polite" aria-atomic="true">{paused && bufferedCount ? `${bufferedCount} new activity update${bufferedCount === 1 ? '' : 's'} buffered.` : ''}</p>
        {paused && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-amber-100">
              Updates are paused. {bufferedCount
                ? `${bufferedCount} new activity update${bufferedCount === 1 ? '' : 's'} buffered.`
                : 'No new activity updates are buffered.'}
            </span>
            {bufferedCount > 0 && (
              <button type="button" onClick={resumeUpdates} className="font-semibold text-amber-200 hover:text-amber-100">
                Resume and show updates
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-4 py-3" role="alert">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-rose-300" aria-hidden="true" />
            <div className="min-w-0">
              <strong className="block text-sm text-rose-100">Monitoring refresh failed</strong>
              <span className="mt-1 block text-sm text-rose-200/70">{error}</span>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-700/60 bg-[#0b1622] shadow-2xl shadow-black/10">
          <div className="grid gap-3 border-b border-slate-700/50 p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_160px_210px_170px_auto]">
            <label className="relative block">
              <span className="sr-only">Search monitored activities</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                type="search"
                value={filters.search}
                onChange={event => setFilters(current => ({ ...current, search: event.target.value }))}
                placeholder="Search detection, asset, user, or ID"
                className="h-10 w-full rounded-lg border border-slate-700 bg-[#07111b] pl-10 pr-9 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10"
              />
              {filters.search && (
                <button
                  type="button"
                  onClick={() => setFilters(current => ({ ...current, search: '' }))}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>

            <label>
              <span className="sr-only">Filter by severity</span>
              <select
                value={filters.severity}
                onChange={event => setFilters(current => ({ ...current, severity: event.target.value }))}
                className="h-10 w-full rounded-lg border border-slate-700 bg-[#07111b] px-3 text-sm text-slate-200 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10"
              >
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>

            <label>
              <span className="sr-only">Filter by source</span>
              <select
                value={filters.source}
                onChange={event => setFilters(current => ({ ...current, source: event.target.value }))}
                className="h-10 w-full rounded-lg border border-slate-700 bg-[#07111b] px-3 text-sm text-slate-200 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10"
              >
                <option value="all">All sources</option>
                {sources.map(source => <option value={source} key={source}>{source}</option>)}
              </select>
            </label>

            <label>
              <span className="sr-only">Filter by time</span>
              <select
                value={filters.time}
                onChange={event => setFilters(current => ({ ...current, time: event.target.value }))}
                className="h-10 w-full rounded-lg border border-slate-700 bg-[#07111b] px-3 text-sm text-slate-200 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10"
              >
                <option value="15m">Last 15 minutes</option>
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="all">All loaded</option>
              </select>
            </label>

            <div className="flex items-center justify-between gap-3 xl:justify-end">
              <span className="whitespace-nowrap text-sm text-slate-400">
                {filteredActivities.length} of {activities.length} loaded
              </span>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => setFilters({ severity: 'all', source: 'all', time: '24h', search: '' })}
                  className="whitespace-nowrap text-sm font-medium text-cyan-300 hover:text-cyan-200"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-4" aria-label="Loading monitoring activities">
              {[0, 1, 2, 3, 4].map(item => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-800/55" />)}
            </div>
          ) : filteredActivities.length ? (<>
            <div className="divide-y divide-slate-800 lg:hidden">
              {filteredActivities.map(activity => {
                const id = activityId(activity);
                return <ActivityCard key={id} activity={activity} id={id} technicalId={representativeId(activity)} severity={severityOf(activity)} expanded={expandedId === id} onToggle={() => setExpandedId(current => current === id ? null : id)} />;
              })}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-700/50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <th className="px-4 py-3">Detection</th>
                    <th className="px-3 py-3">Severity</th>
                    <th className="px-3 py-3">Business asset</th>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Last observed</th>
                    <th className="px-3 py-3 text-right">AI state</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivities.map(activity => {
                    const id = activityId(activity);
                    const technicalId = representativeId(activity);
                    const severity = severityOf(activity);
                    const expanded = expandedId === id;
                    return (
                      <ActivityRows
                        key={id}
                        activity={activity}
                        id={id}
                        technicalId={technicalId}
                        severity={severity}
                        expanded={expanded}
                        onToggle={() => setExpandedId(current => current === id ? null : id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>) : (
            <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
              <div>
                <ShieldCheck className="mx-auto h-8 w-8 text-emerald-300/70" aria-hidden="true" />
                <strong className="mt-4 block text-base text-slate-200">No matching activity in the loaded window</strong>
                <span className="mt-2 block text-sm text-slate-500">Adjust the filters or wait for the next automatic refresh.</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-slate-700/50 px-4 py-3 text-sm text-slate-400">
            <span>{total ? `${((page - 1) * 100 + 1).toLocaleString()}–${Math.min(page * 100, total).toLocaleString()} of ${total.toLocaleString()} individual alerts` : 'No alert records'}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="rounded-lg border border-slate-600 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
              <span className="min-w-16 text-center">Page {page}</span>
              <button type="button" disabled={page * 100 >= total} onClick={() => setPage(value => value + 1)} className="rounded-lg border border-slate-600 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-500">
          Showing raw alert records rather than grouped activity. Human-readable references are used here; full Elastic identifiers remain available in expanded technical details.
        </p>
      </div>
    </section>
  );
}

function ActivityCard({ activity, id, technicalId, severity, expanded, onToggle }) {
  const title = activityTitle(activity);
  const triageTarget = technicalId ? `/alerts?time_range=all&search=${encodeURIComponent(technicalId)}` : '/alerts?time_range=all';
  const severityStyle = SEVERITY_STYLES[severity] || 'border-slate-600 bg-slate-700/30 text-slate-300';
  return <article className="p-4">
    <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`mobile-activity-details-${id}`} className="w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0"><strong className="block text-sm font-semibold leading-5 text-slate-100">{title}</strong><span className="mt-1 block truncate text-xs text-slate-500">{alertReference(activity)}</span></span>
        {expanded ? <ChevronUp className="mt-1 h-4 w-4 flex-none text-slate-400" /> : <ChevronDown className="mt-1 h-4 w-4 flex-none text-slate-400" />}
      </span>
      <span className="mt-3 flex flex-wrap items-center gap-2"><span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold capitalize ${severityStyle}`}>{severity}</span><span className="text-xs font-medium text-slate-300">{businessAssetLabel(activity)}</span><span className="text-xs text-slate-500">AI {humanize(activity.triage_status || 'pending')}</span></span>
      <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>{sourceLabel(activity)}</span><time>{formatTimestamp(activityTimestamp(activity))}</time></span>
    </button>
    {expanded && <div id={`mobile-activity-details-${id}`} className="mt-4 border-t border-slate-700/60 pt-4"><dl className="grid gap-4 sm:grid-cols-2"><Detail icon={Server} label="Host" value={activity.hostname || activity.agent_name || 'Not resolved'} /><Detail icon={User} label="Identity" value={activity.username || 'Not resolved'} /><Detail icon={Database} label="Dataset" value={activity.event_dataset || activity.decoder || 'Elastic'} /><Detail icon={AlertTriangle} label="Detection action" value={activity.event_action || activity.alert_reason || title} /></dl><Link to={triageTarget} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-cyan-400/35 bg-cyan-400/[0.08] px-4 text-sm font-semibold text-cyan-200">Open technical triage</Link></div>}
  </article>;
}

function ActivityRows({ activity, id, technicalId, severity, expanded, onToggle }) {
  const title = activityTitle(activity);
  const asset = businessAssetLabel(activity);
  const severityStyle = SEVERITY_STYLES[severity] || 'border-slate-600 bg-slate-700/30 text-slate-300';
  const triageTarget = technicalId ? `/alerts?time_range=all&search=${encodeURIComponent(technicalId)}` : '/alerts?time_range=all';

  return (
    <>
      <tr className="border-b border-slate-800/80 transition hover:bg-slate-800/25">
        <td className="px-4 py-3.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`activity-details-${id}`}
            className="flex max-w-xl items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          >
            <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.07] text-cyan-300">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <strong className="block text-sm font-semibold leading-5 text-slate-100">{title}</strong>
              <span className="mt-1 block truncate text-xs text-slate-500">{alertReference(activity)}</span>
            </span>
            {expanded ? <ChevronUp className="mt-2 h-4 w-4 flex-none text-slate-400" /> : <ChevronDown className="mt-2 h-4 w-4 flex-none text-slate-400" />}
          </button>
        </td>
        <td className="px-3 py-3.5">
          <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold capitalize ${severityStyle}`}>{severity}</span>
        </td>
        <td className="px-3 py-3.5">
          <span className="block max-w-[220px] truncate text-sm font-medium text-slate-200">{asset}</span>
          <span className="mt-1 block max-w-[220px] truncate text-xs text-slate-500">{activity.username || activity.hostname || 'Entity not resolved'}</span>
        </td>
        <td className="px-3 py-3.5 text-sm text-slate-400">{sourceLabel(activity)}</td>
        <td className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-400">{formatTimestamp(activityTimestamp(activity))}</td>
        <td className="px-3 py-3.5 text-right text-xs font-semibold text-slate-300">{humanize(activity.triage_status || 'pending')}</td>
      </tr>
      {expanded && (
        <tr id={`activity-details-${id}`} className="border-b border-slate-700/60 bg-[#08131e]">
          <td colSpan={6} className="px-5 py-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Detail icon={Server} label="Host" value={activity.hostname || activity.agent_name || 'Not resolved'} />
                <Detail icon={User} label="Identity" value={activity.username || 'Not resolved'} />
                <Detail icon={Database} label="Dataset" value={activity.event_dataset || activity.decoder || 'Elastic'} />
                <Detail icon={AlertTriangle} label="Detection action" value={activity.event_action || activity.alert_reason || title} />
                <Detail label="Source address" value={activity.src_ip || 'Not provided'} />
                <Detail label="Destination address" value={activity.dst_ip || 'Not provided'} />
                <Detail label="First observed" value={formatTimestamp(activity.first_seen || activity.timestamp)} />
                <Detail label="Last observed" value={formatTimestamp(activityTimestamp(activity))} />
                <Detail label="Elastic technical ID" value={technicalId || 'Not provided'} />
              </dl>
              <div className="flex items-end lg:justify-end">
                <Link
                  to={triageTarget}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-cyan-400/35 bg-cyan-400/[0.08] px-4 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/60 hover:bg-cyan-400/[0.12] focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                >
                  Open technical triage
                </Link>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm leading-5 text-slate-300">{value}</dd>
    </div>
  );
}
