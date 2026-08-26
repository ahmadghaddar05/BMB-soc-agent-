import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, CheckCircle2, Database, KeyRound, Network, RefreshCw, Share2, ShieldAlert,
} from 'lucide-react';
import NetworkTopologyCanvas, { TopologyLegend } from '../components/digital-twin/NetworkTopologyCanvas';
import {
  Button, Card, EmptyState, LiveIndicator, SkeletonLoader, StatusChip, Timeline,
} from '../components/ui';
import useSynchronizedEventStream from '../hooks/useSynchronizedEventStream';
import { api } from '../lib/api';
import { activityTitle, alertReference, humanize, severityOf } from '../lib/executive';
import {
  applyAttackEventsToTopology, buildObservedTopology, mapAlertToAttackEvent,
} from '../lib/securityVisualization';

const REFRESH_INTERVAL_MS = 15_000;
const EMPTY_TOPOLOGY = buildObservedTopology([]);

const EVENT_ICONS = {
  access:ShieldAlert,
  credential:KeyRound,
  'lateral-movement':Share2,
  'data-access':Database,
  containment:CheckCircle2,
};

function alertId(alert) {
  return alert?.id || alert?.representative_alert_id || alert?.elastic_alert_uuid || alert?.group_key || null;
}

function eventTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    : 'Time unavailable';
}

export default function DigitalTwin() {
  const [topology, setTopology] = useState(EMPTY_TOPOLOGY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [settledEventId, setSettledEventId] = useState(null);
  const mountedRef = useRef(false);
  const refreshingRef = useRef(false);
  const seenIdsRef = useRef(null);
  const topologyRef = useRef(EMPTY_TOPOLOGY);
  const stream = useSynchronizedEventStream();

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const data = await api('/alerts?limit=100');
      if (!mountedRef.current) return;
      const nextAlerts = data.alerts || [];
      const nextTopology = buildObservedTopology(nextAlerts, { maxNodes:6 });
      if (!topologyRef.current.nodes.length && nextTopology.nodes.length) {
        topologyRef.current = nextTopology;
        setTopology(nextTopology);
      }

      if (seenIdsRef.current == null) {
        seenIdsRef.current = new Set(nextAlerts.map(alertId).filter(Boolean).map(String));
      } else {
        const newAlerts = nextAlerts
          .filter(alert => {
            const id = alertId(alert);
            return id && !seenIdsRef.current.has(String(id));
          })
          .sort((left, right) => new Date(left.timestamp || left.last_seen || 0) - new Date(right.timestamp || right.last_seen || 0));
        nextAlerts.forEach(alert => { const id = alertId(alert); if (id) seenIdsRef.current.add(String(id)); });
        const events = newAlerts
          .map(alert => mapAlertToAttackEvent(alert, topologyRef.current, {
            title:activityTitle(alert),
            severity:severityOf(alert),
          }))
          .filter(Boolean);
        if (events.length) stream.append(events);
      }
      setLastRefresh(new Date());
      setError('');
    } catch (refreshError) {
      if (mountedRef.current) setError(refreshError.message || 'Topology evidence could not be refreshed.');
    } finally {
      refreshingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [stream.append]);

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

  useEffect(() => {
    if (!stream.currentEvent) return undefined;
    const currentId = stream.currentEvent.id;
    const timer = window.setTimeout(() => setSettledEventId(currentId), 1_400);
    return () => window.clearTimeout(timer);
  }, [stream.currentEvent]);

  const activeEventId = stream.currentEvent && settledEventId !== stream.currentEvent.id
    ? stream.currentEvent.id : null;
  const activeTopology = useMemo(
    () => applyAttackEventsToTopology(topology, stream.events, { activeEventId }),
    [activeEventId, stream.events, topology]
  );
  const timelineItems = useMemo(() => stream.events.slice(-30).map(event => {
    const Icon = EVENT_ICONS[event.eventType] || Activity;
    return {
      id:event.id,
      icon:<Icon aria-hidden="true" />,
      title:event.message,
      detail:`${alertReference(event.alertId)} · ${humanize(event.eventType)}`,
      timestamp:eventTime(event.timestamp),
      dateTime:event.timestamp,
      severity:event.severity,
      tone:event.eventType === 'containment' ? 'success' : undefined,
      eventType:event.eventType,
      final:event.eventType === 'containment',
    };
  }), [stream.events]);
  const caption = loading ? 'Loading observed assets' : `${topology.nodes.length} network ${topology.nodes.length === 1 ? 'entity' : 'entities'} mapped from ${topology.evidenceCount} stored alerts`;

  return (
    <div className="digital-twin-page ui-page-enter">
      <div className="digital-twin-layout">
        <Card
          className="digital-twin-topology-card"
          title="Network Topology"
          caption={caption}
          action={<TopologyLegend />}
        >
          {loading ? <div className="digital-twin-loading"><SkeletonLoader lines={6} /></div>
            : error && !topology.nodes.length ? <EmptyState icon={Network} message="Topology evidence is unavailable" action={<Button icon={RefreshCw} onClick={refresh}>Retry</Button>} />
              : topology.nodes.length
                ? <NetworkTopologyCanvas nodes={activeTopology.nodes} edges={activeTopology.edges} />
                : <EmptyState icon={Network} message="No observed network entities" />}
        </Card>

        <Card
          className="digital-twin-feed-card"
          title="Attack Timeline"
          caption={lastRefresh ? `Checked ${eventTime(lastRefresh)}` : 'Waiting for observed activity'}
          action={error ? <StatusChip status="error">Delayed</StatusChip>
            : stream.events.length ? <LiveIndicator /> : <StatusChip status="neutral">Idle</StatusChip>}
        >
          {timelineItems.length
            ? <Timeline className="digital-twin-feed" items={timelineItems} ariaLabel="Live attack narrative" live autoScroll />
            : <EmptyState icon={Activity} message={`No active events — monitoring ${topology.nodes.length} ${topology.nodes.length === 1 ? 'asset' : 'assets'}`} />}
        </Card>
      </div>
    </div>
  );
}
