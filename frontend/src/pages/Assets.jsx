import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Copy, Globe2, Laptop, Network, Search, Server, ShieldAlert, UserRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { copyText, entityOf, parseJson, relativeTime, severityOf } from '../lib/soc';
import { activityTitle, alertReference } from '../lib/executive';
import {
  Button, Card, EmptyState, Select, SeverityBadge, SkeletonLoader, StatusChip, Timeline,
} from '../components/ui';

const rank = { critical:5, high:4, medium:3, low:2, informational:1 };

function assetIcon(kind) {
  if (kind === 'host') return Server;
  if (kind === 'identity') return UserRound;
  return Network;
}

function aiState(alert) {
  const status = String(alert?.triage_status || '').toLowerCase();
  if (status === 'triaged') return 'Triaged';
  if (status === 'triage_failed') return 'Failed';
  if (status === 'skipped') return 'Skipped';
  return 'Pending';
}

export default function Assets() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/alerts?limit=100');
      setAlerts(data.alerts || []);
    } catch (loadError) {
      setError(loadError.message || 'Observed entity data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const assets = useMemo(() => {
    const map = new Map();
    const add = (kind, value, alert) => {
      if (!value) return;
      const key = `${kind}:${value}`;
      const item = map.get(key) || {
        key, kind, value, alerts:[], severity:'informational',
        firstSeen:alert.timestamp, lastSeen:alert.timestamp,
      };
      item.alerts.push(alert);
      if (String(alert.timestamp || '') > String(item.lastSeen || '')) item.lastSeen = alert.timestamp;
      if (String(alert.timestamp || '') < String(item.firstSeen || '')) item.firstSeen = alert.timestamp;
      const severity = severityOf(alert);
      if ((rank[severity] || 0) > (rank[item.severity] || 0)) item.severity = severity;
      map.set(key, item);
    };
    alerts.forEach(alert => {
      add('host', alert.hostname || alert.agent_name, alert);
      add('identity', alert.username, alert);
      add('address', alert.src_ip, alert);
    });
    return [...map.values()].sort((left, right) => (rank[right.severity] - rank[left.severity]) || right.alerts.length - left.alerts.length);
  }, [alerts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter(asset => (type === 'all' || asset.kind === type) && (!term || asset.value.toLowerCase().includes(term)));
  }, [assets, search, type]);
  const selected = filtered.find(asset => asset.key === selectedKey) || filtered[0] || null;
  const counts = useMemo(() => ({
    host:assets.filter(asset => asset.kind === 'host').length,
    identity:assets.filter(asset => asset.kind === 'identity').length,
    address:assets.filter(asset => asset.kind === 'address').length,
    highRisk:assets.filter(asset => rank[asset.severity] >= 4).length,
  }), [assets]);

  const timelineItems = useMemo(() => (selected?.alerts || []).slice(0, 8).map(alert => {
    const verdict = parseJson(alert.verdict);
    return {
      id:alert.id,
      icon:<ShieldAlert aria-hidden="true" />,
      title:activityTitle(alert),
      detail:`${alertReference(alert)} · ${entityOf(alert)} · AI ${verdict.verdict?.replaceAll('_', ' ') || aiState(alert).toLowerCase()}`,
      meta:relativeTime(alert.timestamp),
    };
  }), [selected]);

  function openAlerts(asset) {
    const key = asset.kind === 'host' ? 'hostname' : asset.kind === 'identity' ? 'username' : 'src_ip';
    navigate(`/alerts?search=${encodeURIComponent(asset.value)}&${key}=${encodeURIComponent(asset.value)}`);
  }

  return (
    <div className="assets-page-v2 ui-page-enter">
      <section className="assets-kpi-strip" aria-label="Observed entity summary">
        <article><small>Observed hosts</small><strong>{counts.host}</strong></article>
        <article><small>Observed identities</small><strong>{counts.identity}</strong></article>
        <article><small>Source addresses</small><strong>{counts.address}</strong></article>
        <article className="is-attention"><small>High-risk entities</small><strong>{counts.highRisk}</strong></article>
      </section>

      {error && <div className="assets-error" role="alert"><ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" /><span>{error}</span><button type="button" onClick={load}>Retry</button></div>}

      <div className="assets-layout-v2">
        <Card compact className="assets-inventory-v2" title="Observed entities" caption="Evidence-derived sample from the latest 100 stored alerts" action={<StatusChip status={alerts.length ? 'active' : 'neutral'}>{alerts.length} alerts sampled</StatusChip>}>
          <div className="assets-filter-bar">
            <label className="assets-search"><Search size={16} strokeWidth={1.5} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter host, identity, or IP" aria-label="Filter observed entities" /></label>
            <Select aria-label="Observed entity type" value={type} onChange={event => setType(event.target.value)}><option value="all">All types</option><option value="host">Hosts</option><option value="identity">Identities</option><option value="address">Addresses</option></Select>
          </div>
          {loading ? <div className="assets-loading"><SkeletonLoader lines={7} /></div> : filtered.length ? (
            <ol className="assets-list-v2" aria-label={`${filtered.length} observed entities`}>
              {filtered.map(asset => {
                const Icon = assetIcon(asset.kind);
                return <li key={asset.key} className={`is-${asset.severity}`}><button type="button" className={selected?.key === asset.key ? 'is-selected' : ''} onClick={() => setSelectedKey(asset.key)} aria-current={selected?.key === asset.key ? 'true' : undefined}><span className="assets-kind-icon"><Icon aria-hidden="true" /></span><span><strong>{asset.value}</strong><small>{asset.kind} · seen {relativeTime(asset.lastSeen)}</small></span><SeverityBadge severity={asset.severity} /><b>{asset.alerts.length}<small>alerts</small></b></button></li>;
              })}
            </ol>
          ) : <EmptyState icon={Search} message="No entities match these filters" action="Adjust filters" />}
        </Card>

        <div className="asset-detail-stack-v2">
          {selected ? <>
            <Card className="asset-profile-v2">
              <header className="asset-profile-header">
                <span className="asset-profile-icon">{selected.kind === 'host' ? <Server aria-hidden="true" /> : selected.kind === 'identity' ? <UserRound aria-hidden="true" /> : <Globe2 aria-hidden="true" />}</span>
                <div><span>{selected.kind}</span><h2>{selected.value}</h2><p>Observed in {selected.alerts.length} sampled security alerts</p></div>
                <SeverityBadge severity={selected.severity} />
              </header>
              <div className="asset-profile-actions"><Button variant="primary" icon={Bell} onClick={() => openAlerts(selected)}>View related alerts</Button><Button icon={Search} onClick={() => navigate(`/investigations?search=${encodeURIComponent(selected.value)}`)}>Build investigation</Button><Button icon={Copy} onClick={() => copyText(selected.value)}>Copy identifier</Button></div>
              <dl className="asset-facts-v2"><div><dt>First observed</dt><dd>{relativeTime(selected.firstSeen)}</dd></div><div><dt>Last observed</dt><dd>{relativeTime(selected.lastSeen)}</dd></div><div><dt>Critical or high</dt><dd>{selected.alerts.filter(alert => rank[severityOf(alert)] >= 4).length}</dd></div><div><dt>AI triaged</dt><dd>{selected.alerts.filter(alert => alert.triage_status === 'triaged').length}</dd></div></dl>
            </Card>
            <Card title="Recent security activity" caption="Newest stored evidence involving this entity" action={<StatusChip>{timelineItems.length} records</StatusChip>}>
              {timelineItems.length ? <Timeline className="asset-activity-timeline" items={timelineItems} /> : <EmptyState icon={Laptop} message="No recent activity is available" />}
            </Card>
          </> : !loading && <Card><EmptyState icon={Server} message="Select an observed entity" /></Card>}
        </div>
      </div>
    </div>
  );
}
