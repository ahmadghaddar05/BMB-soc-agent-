import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Crosshair, Database, Fingerprint, Gauge,
  Globe2, Network, RefreshCw, Server, ShieldAlert, Users,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../lib/api';

const COLORS = {
  critical:'#ef4e5d', high:'#f59e45', medium:'#45a8ed', low:'#4bc7a4',
  other:'#647b8c', blue:'#42aaf2', cyan:'#43d0e8', purple:'#9b7cf7',
};

function compactNumber(value) {
  return new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(Number(value || 0));
}

function bucketLabel(value, hours) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || '');
  return hours === 24
    ? date.toLocaleTimeString([], { hour:'2-digit' })
    : date.toLocaleDateString([], { month:'short', day:'numeric' });
}

function AnalyticsCard({ icon:Icon, title, subtitle, className = '', children, empty }) {
  return (
    <section className={`soc-chart-card ${className}`}>
      <header><Icon /><span><strong>{title}</strong><small>{subtitle}</small></span></header>
      {empty ? <div className="soc-chart-empty"><Database /><strong>Required fields are unavailable</strong><span>This chart remains empty until matching stored evidence is collected.</span></div> : children}
    </section>
  );
}

function RankingBars({ data, color = COLORS.blue, onSelect, valueKey = 'count' }) {
  const maximum = Math.max(1, ...data.map(item => Number(item[valueKey] || 0)));
  return (
    <div className="soc-ranking-bars">
      {data.map((item,index) => (
        <button type="button" key={`${item.name}-${index}`} onClick={() => onSelect?.(item)}>
          <span className="soc-rank">{String(index + 1).padStart(2, '0')}</span>
          <span><strong title={item.name}>{item.name}</strong><i><b style={{ width:`${Math.max(4, (Number(item[valueKey] || 0) / maximum) * 100)}%`, background:color }} /></i></span>
          <span className="soc-rank-value"><b>{compactNumber(item[valueKey])}</b>{item.high_risk != null && <small>{compactNumber(item.high_risk)} high risk</small>}</span>
        </button>
      ))}
    </div>
  );
}

export default function SOCAnalytics() {
  const navigate = useNavigate();
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    setLoading(true);
    setError('');
    try {
      const result = await api(`/analytics/security?hours=${hours}`);
      setData(result);
      setUpdatedAt(new Date(result.generated_at || Date.now()));
    } catch (loadError) {
      setError(loadError.message || 'Security analytics could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(load, 60_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', load);
    };
  }, [load]);

  const model = useMemo(() => {
    if (!data) return null;
    const summary = data.summary || {};
    const total = Number(summary.total_alerts || 0);
    return {
      ...data,
      summary,
      triageCoverage:total ? Math.round((Number(summary.triaged || 0) / total) * 100) : 0,
      correlationCoverage:total ? Math.round((Number(summary.correlation_decisions || 0) / total) * 100) : 0,
      trend:(data.trend || []).map(item => ({ ...item, label:bucketLabel(item.bucket, hours) })),
    };
  }, [data, hours]);

  const openAlertSearch = item => navigate(`/alerts?search=${encodeURIComponent(item.name)}`);

  return (
    <div className="soc-analytics-page">
      <header className="soc-analytics-hero">
        <div><span><Activity />Analyst visibility</span><h2>Security Analytics</h2><p>Evidence-backed patterns across stored Elastic alerts. Use these views to choose pivots; use Triage and Incidents to make decisions.</p></div>
        <div className="soc-analytics-controls">
          <div>{[[24,'24 hours'],[168,'7 days'],[720,'30 days']].map(([value,label]) => <button type="button" className={hours === value ? 'active' : ''} key={value} onClick={() => setHours(value)}>{label}</button>)}</div>
          <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button>
          <small>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}` : 'Awaiting data'}</small>
        </div>
      </header>

      {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={load}>Retry</button></div>}
      {!model && !error && <div className="soc-analytics-loading"><RefreshCw className="animate-spin" /><strong>Building security analytics</strong><span>Aggregating stored alerts inside the selected window.</span></div>}

      {model && (
        <>
          <section className="soc-analytics-metrics" aria-label="Security analytics summary">
            <article><span><ShieldAlert /></span><div><small>Stored alerts</small><strong>{compactNumber(model.summary.total_alerts)}</strong><p>Selected time window</p></div></article>
            <article className="critical"><span><AlertTriangle /></span><div><small>Critical and high</small><strong>{compactNumber(Number(model.summary.critical || 0) + Number(model.summary.high || 0))}</strong><p>{compactNumber(model.summary.critical)} critical</p></div></article>
            <article><span><Globe2 /></span><div><small>Unique source IPs</small><strong>{compactNumber(model.summary.unique_source_ips)}</strong><p>Observed, not attributed</p></div></article>
            <article><span><Crosshair /></span><div><small>Observed targets</small><strong>{compactNumber(model.summary.unique_targets)}</strong><p>Host, database, or destination IP</p></div></article>
            <article className="purple"><span><Network /></span><div><small>Correlation decisions</small><strong>{model.correlationCoverage}%</strong><p>{compactNumber(model.summary.correlation_decisions)} alerts processed</p></div></article>
          </section>

          <div className="soc-analytics-grid">
            <AnalyticsCard icon={Activity} title="Alert activity trend" subtitle="Critical, high, and other stored alerts over time" className="trend">
              <div className="soc-chart" role="img" aria-label="Alert activity trend chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={model.trend} margin={{ top:12, right:18, left:-18, bottom:0 }}>
                    <defs>
                      <linearGradient id="criticalFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.critical} stopOpacity=".38" /><stop offset="100%" stopColor={COLORS.critical} stopOpacity=".02" /></linearGradient>
                      <linearGradient id="highFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.high} stopOpacity=".3" /><stop offset="100%" stopColor={COLORS.high} stopOpacity=".02" /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="#173247" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill:'#66869b', fontSize:9 }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fill:'#66869b', fontSize:9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background:'#081a28', border:'1px solid #24465d', borderRadius:8, fontSize:11 }} />
                    <Area type="monotone" dataKey="other" stackId="1" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity=".1" />
                    <Area type="monotone" dataKey="high" stackId="1" stroke={COLORS.high} fill="url(#highFill)" />
                    <Area type="monotone" dataKey="critical" stackId="1" stroke={COLORS.critical} fill="url(#criticalFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </AnalyticsCard>

            <AnalyticsCard icon={Gauge} title="Severity distribution" subtitle="Source severity across the same alert window" empty={!model.severity.length}>
              <div className="soc-donut-layout" role="img" aria-label="Alert severity distribution chart">
                <ResponsiveContainer width="58%" height={215}>
                  <PieChart><Pie data={model.severity} dataKey="count" nameKey="name" innerRadius={54} outerRadius={79} paddingAngle={2}>{model.severity.map(item => <Cell key={item.name} fill={COLORS[item.name] || COLORS.other} />)}</Pie><Tooltip contentStyle={{ background:'#081a28', border:'1px solid #24465d', borderRadius:8, fontSize:11 }} /></PieChart>
                </ResponsiveContainer>
                <div>{model.severity.map(item => <p key={item.name}><i style={{background:COLORS[item.name] || COLORS.other}} /><span>{item.name}</span><strong>{compactNumber(item.count)}</strong></p>)}</div>
              </div>
            </AnalyticsCard>

            <AnalyticsCard icon={Globe2} title="Top source IPs" subtitle="Addresses generating the most stored alert activity" empty={!model.top_source_ips.length}>
              <RankingBars data={model.top_source_ips} color={COLORS.cyan} onSelect={openAlertSearch} />
            </AnalyticsCard>

            <AnalyticsCard icon={Server} title="Most targeted destinations" subtitle="Hosts, databases, and destination addresses" empty={!model.top_destinations.length}>
              <RankingBars data={model.top_destinations} color={COLORS.critical} onSelect={openAlertSearch} />
            </AnalyticsCard>

            <AnalyticsCard icon={Database} title="Telemetry sources" subtitle="Datasets contributing security alerts" empty={!model.top_datasets.length}>
              <RankingBars data={model.top_datasets} color={COLORS.blue} onSelect={openAlertSearch} />
            </AnalyticsCard>

            <AnalyticsCard icon={Crosshair} title="ATT&CK tactic coverage" subtitle="Mapped tactics in stored alert evidence" empty={!model.mitre_tactics.length}>
              <RankingBars data={model.mitre_tactics} color={COLORS.purple} onSelect={openAlertSearch} />
            </AnalyticsCard>

            <AnalyticsCard icon={Users} title="Most exposed identities" subtitle="Users ranked by high-risk and total activity" empty={!model.top_identities.length}>
              <RankingBars data={model.top_identities} color={COLORS.high} onSelect={openAlertSearch} />
            </AnalyticsCard>

            <AnalyticsCard icon={Fingerprint} title="Frequent detection types" subtitle="Repeated detection reasons requiring queue tuning" empty={!model.top_detections.length}>
              <RankingBars data={model.top_detections} color={COLORS.low} onSelect={openAlertSearch} />
            </AnalyticsCard>
          </div>

          <footer className="soc-analytics-trust"><Database /><p><strong>Data boundary</strong><span>All charts use stored BMB alert fields from the selected period. Missing source IP, identity, destination, or ATT&amp;CK fields reduce chart coverage and are not estimated.</span></p><small>Triage coverage {model.triageCoverage}%</small></footer>
        </>
      )}
    </div>
  );
}
