import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, Bot, ChevronRight, CircleAlert, Clock3, Database,
  Pause, Play, Server, ShieldCheck, ShieldX, Sparkles, Target, Zap,
} from 'lucide-react';
import { api, fmtTs, sevClass, verdictLabel } from '../lib/api';
import InfoTip from '../components/InfoTip';

const SEVERITY_COLORS = {
  critical: '#ef4453', high: '#ff8a34', medium: '#f2c94c', low: '#25cf91', informational: '#4d83ff',
};

const FALLBACK_ACTIVITY = [
  { label: '12:00', fetched: 120, stored: 98 }, { label: '15:00', fetched: 220, stored: 180 },
  { label: '18:00', fetched: 165, stored: 148 }, { label: '21:00', fetched: 310, stored: 286 },
  { label: '00:00', fetched: 275, stored: 244 }, { label: '03:00', fetched: 390, stored: 352 },
  { label: '06:00', fetched: 245, stored: 221 }, { label: '09:00', fetched: 330, stored: 306 },
];

function number(value) {
  return Number.parseInt(value || 0, 10) || 0;
}

function safeVerdict(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function severityOf(item) {
  return item.source_severity || (number(item.rule_level) >= 12 ? 'critical' : number(item.rule_level) >= 9 ? 'high' : number(item.rule_level) >= 6 ? 'medium' : 'low');
}

function timeAgo(timestamp) {
  if (!timestamp) return 'now';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function MiniBars({ values = [], color = '#3988ff' }) {
  const data = values.length ? values.slice(-14) : [2, 4, 3, 6, 5, 8, 4, 7, 9, 6, 10, 7, 11, 8];
  const max = Math.max(...data, 1);
  return <span className="mini-bars" aria-hidden="true">{data.map((value, index) => <i key={index} style={{ height: `${Math.max(18, value / max * 100)}%`, background: color }} />)}</span>;
}

function MetricCard({ icon: Icon, label, value, note, help, tone = 'blue', trend = [] }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-card-top"><span className="metric-icon"><Icon /></span><span className="metric-label">{label}<InfoTip text={help || note} align="right" /></span></div>
      <div className="metric-card-bottom">
        <div><strong>{number(value).toLocaleString()}</strong><small>{note}</small></div>
        <MiniBars values={trend} color={tone === 'red' ? '#ef4453' : tone === 'orange' ? '#ff8a34' : tone === 'purple' ? '#8a6cff' : '#3988ff'} />
      </div>
    </article>
  );
}

function PanelHeading({ icon: Icon, title, help, action }) {
  return <div className="panel-heading"><h2>{Icon && <Icon size={15} />}{title}<InfoTip text={help || `About ${title}`} align="left" /></h2>{action}</div>;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label && <strong>{label}</strong>}
      {payload.map(item => <span key={item.dataKey || item.name}><i style={{ background: item.color || item.payload?.fill }} />{item.name}: <b>{number(item.value).toLocaleString()}</b></span>)}
    </div>
  );
}

function RiskGauge({ score }) {
  const degrees = Math.round(score / 1000 * 180);
  const classification = score >= 751 ? 'Critical' : score >= 551 ? 'Elevated' : score >= 301 ? 'Guarded' : 'Low';
  return (
    <div className="risk-gauge-wrap">
      <div className="risk-gauge" style={{ '--risk-degrees': `${degrees}deg` }}><div className="risk-gauge-inner" /></div>
      <div className="risk-gauge-value"><strong>{score}</strong><span>/1000</span><small>{classification} Risk</small></div>
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="dashboard-empty"><ShieldCheck size={22} /><span>{children}</span></div>;
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [collector, setCollector] = useState(null);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const [feedPaused, setFeedPaused] = useState(false);
  const [frozenFeed, setFrozenFeed] = useState([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [statsData, collectorData, queueData] = await Promise.all([
          api('/stats'),
          api('/collector/status'),
          api('/alert-groups?page=1&limit=8').catch(() => ({ groups: [] })),
        ]);
        if (!active) return;
        setStats(statsData);
        setCollector(collectorData);
        setQueue(queueData.groups || []);
        setUpdatedAt(new Date());
        setError(null);
      } catch (loadError) {
        if (active) setError(loadError.message);
      }
    }
    load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const model = useMemo(() => {
    if (!stats || !collector) return null;
    const alerts = stats.alerts || {};
    const incidents = stats.incidents || {};
    const runs = stats.recent_runs || [];
    const total = number(alerts.grouped_activities || alerts.total);
    const critical = number(alerts.critical_activities);
    const high = number(alerts.high_activities);
    const open = number(incidents.open);
    const triaged = number(alerts.triaged);
    const pending = Math.max(0, number(alerts.triage_pending_activities || alerts.triage_pending || total - triaged));
    const severityPressure = total ? Math.min(1, (critical + high * 0.55) / Math.max(total * 0.18, 1)) : 0;
    const incidentPressure = Math.min(1, open / 20);
    const pendingPressure = total ? Math.min(1, pending / total) : 0;
    const risk = Math.min(1000, Math.round((severityPressure * 0.5 + incidentPressure * 0.3 + pendingPressure * 0.2) * 1000));
    const activity = (stats.alert_activity || []).map(item => ({
      label: new Date(item.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      activities: number(item.activities), raw_alerts: number(item.raw_alerts),
    }));
    const severity = (stats.severity_split || []).map(item => ({ name: item.severity, value: number(item.n) })).filter(item => item.value > 0);
    return { alerts, incidents, runs, total, critical, high, open, triaged, pending, risk, activity, severity };
  }, [stats, collector]);

  if (error) return <div className="dashboard-state error"><CircleAlert /><div><strong>Dashboard unavailable</strong><span>{error}</span></div></div>;
  if (!model) return <div className="dashboard-loading"><span /><span /><span /><span /></div>;

  const runTrend = model.activity.map(item => item.activities);
  const liveFeed = queue.slice(0, 7);
  const feed = feedPaused ? frozenFeed : liveFeed;
  const topSources = (stats.top_src_ips || []).slice(0, 5);
  const maxSource = Math.max(...topSources.map(item => number(item.n)), 1);
  const collectorRunning = collector.collector?.cycle_active || (collector.collector?.scheduler_enabled && collector.collector?.scheduler_running);

  return (
    <div className="dashboard-page">
      <div className="dashboard-intro">
        <div>
          <p className="eyebrow"><Activity size={13} /> Live security posture</p>
          <h2>Welcome back, Analyst</h2>
          <p>Your environment is being monitored across Elastic, enrichment, and AI correlation.</p>
        </div>
        <div className="dashboard-status-row">
          <span className={`live-pill ${collectorRunning ? 'online' : 'offline'}`}><i />{collectorRunning ? 'Live monitoring' : 'Collector stopped'}</span>
          <span className="last-sync"><Clock3 size={14} /> Synced {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      <div className="dashboard-layout">
        <section className="dashboard-main">
          <div className="metrics-grid">
            <MetricCard icon={Database} label="Total Activities" value={model.total} note={`${number(model.alerts.elastic_total).toLocaleString()} raw alerts`} help="Distinct grouped security activities collected from Elastic." trend={runTrend} />
            <MetricCard icon={AlertTriangle} label="Critical Activities" value={model.critical} note="Requires immediate review" help="Activities rated critical by their source severity or risk score." tone="red" trend={runTrend.map(v => v * 0.7)} />
            <MetricCard icon={ShieldX} label="Open Incidents" value={model.open} note={`${number(model.incidents.total).toLocaleString()} total incidents`} help="Correlated investigations that have not yet been closed." tone="orange" trend={runTrend.map(v => v * 0.45)} />
            <MetricCard icon={Bot} label="Pending AI Triage" value={model.pending} note={`${model.triaged.toLocaleString()} completed`} help="Activities waiting for AI-assisted classification and investigation." tone="purple" trend={runTrend.map(v => v * 0.6)} />
          </div>

          <div className="analytics-grid">
            <article className="dashboard-panel risk-panel">
              <PanelHeading icon={ShieldCheck} title="Security Risk Score" help="A 0–1000 posture score calculated from critical activity, open incidents, and triage backlog." />
              <RiskGauge score={model.risk} />
              <p className="risk-caption">Calculated from critical activity, open incidents, and pending triage.</p>
            </article>

            <article className="dashboard-panel activity-panel">
              <PanelHeading icon={Activity} title="Alert Activity" help="Real Elastic alert volume grouped by hour. This is independent of the collector's fixed batch size." action={<span className="panel-filter">Last 24 hours</span>} />
              <div className="activity-legend"><span><i className="fetched" />Grouped activities</span><span><i className="stored" />Raw alerts</span></div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={model.activity} margin={{ top: 14, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="activityFetched" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3988ff" stopOpacity={0.42} /><stop offset="100%" stopColor="#3988ff" stopOpacity={0} /></linearGradient>
                    <linearGradient id="activityStored" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3ee6c2" stopOpacity={0.24} /><stop offset="100%" stopColor="#3ee6c2" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1b3047" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#688198', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#688198', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="activities" name="Grouped activities" stroke="#3988ff" strokeWidth={2} fill="url(#activityFetched)" activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="raw_alerts" name="Raw alerts" stroke="#3ee6c2" strokeWidth={1.5} fill="url(#activityStored)" />
                </AreaChart>
              </ResponsiveContainer>
            </article>

            <article className="dashboard-panel severity-panel">
              <PanelHeading icon={Target} title="Activities by Severity" help="Current grouped activities split by source severity." />
              {model.severity.length ? (
                <div className="severity-content">
                  <div className="donut-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={model.severity} dataKey="value" nameKey="name" innerRadius={48} outerRadius={67} paddingAngle={2} stroke="none">
                        {model.severity.map(item => <Cell key={item.name} fill={SEVERITY_COLORS[item.name] || '#526b84'} />)}
                      </Pie><Tooltip content={<ChartTooltip />} /></PieChart>
                    </ResponsiveContainer>
                    <div className="donut-total"><strong>{model.total.toLocaleString()}</strong><span>Total</span></div>
                  </div>
                  <div className="severity-legend">{model.severity.map(item => <div key={item.name}><span><i style={{ background: SEVERITY_COLORS[item.name] || '#526b84' }} />{item.name}</span><strong>{item.value.toLocaleString()}</strong></div>)}</div>
                </div>
              ) : <EmptyState>No severity data yet</EmptyState>}
            </article>
          </div>

          <div className="operations-grid">
            <article className="dashboard-panel sources-panel">
              <PanelHeading icon={Server} title="Most Active Sources" help="Source IPs associated with the largest number of grouped activities." />
              <div className="source-list">
                {topSources.map((item, index) => (
                  <div className="source-row" key={item.src_ip || index}>
                    <span className="source-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{item.src_ip || 'Unknown source'}</strong><span><i style={{ width: `${number(item.n) / maxSource * 100}%` }} /></span></div>
                    <b>{number(item.n).toLocaleString()}</b>
                  </div>
                ))}
                {!topSources.length && <EmptyState>No source activity yet</EmptyState>}
              </div>
              <Link className="panel-link" to="/threat-intelligence">Open IOC pivot <ChevronRight size={13} /></Link>
            </article>

            <article className="dashboard-panel queue-panel">
              <PanelHeading icon={Zap} title="Priority Investigation Queue" help="The newest high-priority activities available for analyst review." action={<Link to="/alerts">View all <ChevronRight size={13} /></Link>} />
              <div className="queue-table-wrap">
                <table className="queue-table">
                  <thead><tr><th>Severity</th><th>Entity / Activity</th><th>AI verdict</th><th>Confidence</th><th>Age</th></tr></thead>
                  <tbody>
                    {queue.slice(0, 5).map((item, index) => {
                      const severity = severityOf(item);
                      const verdict = safeVerdict(item.verdict);
                      const confidence = verdict?.confidence != null ? Math.round(verdict.confidence * 100) : null;
                      return (
                        <tr key={item.group_key || item.representative_alert_id || index}>
                          <td><span className={`badge ${sevClass(severity)}`}>{severity}</span></td>
                          <td><strong>{item.hostname || item.username || item.src_ip || 'Unknown entity'}</strong><span>{item.rule_desc || 'Security activity'}</span></td>
                          <td><span className={`verdict-text verdict-${verdict?.verdict || 'pending'}`}><Sparkles size={12} />{verdict ? verdictLabel(verdict.verdict) : 'Awaiting triage'}</span></td>
                          <td>{confidence == null ? <span className="confidence-muted">—</span> : <div className="confidence"><span>{confidence}%</span><i><b style={{ width: `${confidence}%` }} /></i></div>}</td>
                          <td><time>{timeAgo(item.last_seen || item.timestamp)}</time></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!queue.length && <EmptyState>No investigations are waiting</EmptyState>}
              </div>
            </article>
          </div>

          <article className="dashboard-panel collector-strip">
            <div className="collector-summary"><span className={`collector-icon ${collectorRunning ? 'online' : ''}`}><Database /></span><div><strong>Elastic Collector</strong><span>{collector.collector?.source?.toUpperCase() || 'ELASTIC'} · cursor {collector.collector?.cursor_enabled ? 'enabled' : 'disabled'}</span></div></div>
            <div className="collector-facts"><span><small>Interval</small><strong>{collector.collector?.interval_minutes || '—'} min</strong></span><span><small>Capacity</small><strong>{number(collector.collector?.max_alerts_per_cycle).toLocaleString()}</strong></span><span><small>Enrichment failures</small><strong className={number(collector.database?.enrichment_failed) ? 'danger' : ''}>{number(collector.database?.enrichment_failed)}</strong></span><span><small>Latest run</small><strong>{collector.latest_run ? `#${collector.latest_run.id} · ${collector.latest_run.status}` : 'No runs'}</strong></span></div>
          </article>
        </section>

        <aside className="security-feed dashboard-panel">
          <PanelHeading icon={Activity} title={feedPaused ? 'Security Feed Paused' : 'Live Security Feed'} help="Newest grouped activities received from Elastic." action={<button className={`feed-pause ${feedPaused ? 'paused' : ''}`} aria-label={feedPaused ? 'Resume feed' : 'Pause feed'} onClick={() => { if (!feedPaused) setFrozenFeed(liveFeed); setFeedPaused(value => !value); }}>{feedPaused ? <Play size={12} /> : <Pause size={12} />}</button>} />
          <div className="feed-list">
            {feed.map((item, index) => {
              const severity = severityOf(item);
              return (
                <div className="feed-item" key={item.group_key || item.representative_alert_id || index}>
                  <i className={`feed-dot feed-${severity}`} />
                  <div><strong>{item.rule_desc || 'Security activity detected'}</strong><span>{item.hostname || item.username || item.src_ip || 'Elastic source'}</span><em className={`feed-tag feed-${severity}`}>{severity}</em></div>
                  <time>{timeAgo(item.last_seen || item.timestamp)}</time>
                </div>
              );
            })}
            {!feed.length && <EmptyState>Waiting for live security activity</EmptyState>}
          </div>
          <Link className="panel-link feed-link" to="/alerts">View full feed <ChevronRight size={13} /></Link>
          <div className="feed-health">
            <span><i className={collectorRunning ? 'online' : ''} /><div><strong>{collectorRunning ? 'All systems operational' : 'Collector attention needed'}</strong><small>{fmtTs(collector.latest_run?.started_at)}</small></div></span>
          </div>
        </aside>
      </div>
    </div>
  );
}
