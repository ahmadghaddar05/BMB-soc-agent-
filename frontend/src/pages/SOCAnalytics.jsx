import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../lib/api';
import {
  Button, Card, EmptyState, KpiTile, RankedBarList, SegmentedControl,
  SkeletonLoader,
} from '../components/ui';

const WINDOWS = [
  { value:24, label:'24h' },
  { value:168, label:'7d' },
  { value:720, label:'30d' },
];

function compactNumber(value) {
  return new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(Math.round(Number(value || 0)));
}

function bucketLabel(value, hours) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || '');
  return hours === 24
    ? date.toLocaleTimeString([], { hour:'2-digit' })
    : date.toLocaleDateString([], { month:'short', day:'numeric' });
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload || {};
  return (
    <div className="analytics-tooltip">
      <strong>{label}</strong>
      <span>Total <b>{compactNumber(item.total)}</b></span>
      <span>Critical and high <b>{compactNumber(Number(item.critical || 0) + Number(item.high || 0))}</b></span>
      <span>Unique sources <b>{compactNumber(item.unique_sources)}</b></span>
    </div>
  );
}

function SeverityDistribution({ data, onSelect }) {
  const total = data.reduce((sum, item) => sum + Number(item.count || 0), 0);
  return (
    <div className="analytics-severity">
      <div className="analytics-severity-stack" role="group" aria-label={`Severity distribution across ${total.toLocaleString()} stored alerts`}>
        {data.map(item => {
          const name = String(item.name || 'other').toLowerCase();
          const percentage = total ? (Number(item.count || 0) / total) * 100 : 0;
          return (
            <button
              type="button"
              key={name}
              className={`is-${['critical', 'high', 'medium', 'low'].includes(name) ? name : 'other'}`}
              style={{ '--segment-width':`${percentage}%` }}
              onClick={() => onSelect(item)}
              aria-label={`${name}: ${Number(item.count || 0).toLocaleString()} alerts`}
              title={`${name}: ${percentage.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <ul>
        {data.map(item => {
          const name = String(item.name || 'other').toLowerCase();
          const percentage = total ? (Number(item.count || 0) / total) * 100 : 0;
          return (
            <li key={name}>
              <i className={`is-${['critical', 'high', 'medium', 'low'].includes(name) ? name : 'other'}`} aria-hidden="true" />
              <span>{name}</span>
              <strong>{compactNumber(item.count)}</strong>
              <small>{percentage.toFixed(1)}%</small>
            </li>
          );
        })}
      </ul>
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
    const trend = (data.trend || []).map(item => ({
      ...item,
      label:bucketLabel(item.bucket, hours),
      risk:Number(item.critical || 0) + Number(item.high || 0),
    }));
    return {
      ...data,
      summary,
      trend,
      severity:data.severity || [],
      top_source_ips:data.top_source_ips || [],
      top_destinations:data.top_destinations || [],
      top_datasets:data.top_datasets || [],
      top_identities:data.top_identities || [],
      mitre_tactics:data.mitre_tactics || [],
      total:Number(summary.total_alerts || 0),
      totalSparkline:trend.map(item => Number(item.total || 0)),
      riskSparkline:trend.map(item => item.risk),
      sourceSparkline:trend.map(item => Number(item.unique_sources || 0)),
    };
  }, [data, hours]);

  const openAlertSearch = item => navigate(`/alerts?search=${encodeURIComponent(item.name)}`);
  const openSeverity = item => navigate(`/alerts?severity=${encodeURIComponent(String(item.name || '').toLowerCase())}`);

  const trendActions = (
    <div className="analytics-trend-actions">
      <SegmentedControl label="Analytics time range" value={hours} options={WINDOWS} onChange={setHours} />
      <time dateTime={updatedAt?.toISOString()}>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}` : 'Awaiting data'}</time>
      <Button icon={RefreshCw} iconOnly onClick={load} disabled={loading} aria-label="Refresh security analytics" title="Refresh security analytics" />
    </div>
  );

  return (
    <div className="analytics-page ui-page-enter">
      {error && (
        <div className="analytics-error" role="alert">
          <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={load}>Retry</button>
        </div>
      )}

      {!model && !error && (
        <div className="analytics-loading" aria-label="Loading security analytics">
          <SkeletonLoader lines={3} />
          <div className="analytics-loading-kpis">
            {[0, 1, 2].map(item => <SkeletonLoader key={item} lines={2} />)}
          </div>
        </div>
      )}

      {model && model.total === 0 && (
        <Card action={trendActions}>
          <EmptyState icon={Database} message="No alerts in this range" action={<button type="button" onClick={() => setHours(720)}>Show 30 days</button>} />
        </Card>
      )}

      {model && model.total > 0 && (
        <>
          <Card
            className="analytics-trend-card"
            title="Security activity trend"
            caption="Stored alerts observed across the selected period"
            action={trendActions}
          >
            <div className="analytics-trend-chart" role="img" aria-label="Stored security alerts over time">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={model.trend} margin={{ top:12, right:8, left:-16, bottom:0 }}>
                  <defs>
                    <linearGradient id="analyticsTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity=".08" />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis axisLine={false} tickLine={false} allowDecimals={false} width={48} />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke:'var(--border-default)', strokeWidth:1 }} />
                  <Area
                    className="ui-chart-line"
                    type="monotone"
                    dataKey="total"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#analyticsTrendFill)"
                    isAnimationActive
                    animationDuration={600}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <section className="analytics-kpis ui-card-grid" aria-label="Security analytics summary">
            <KpiTile label="Stored Alerts" value={model.total} formatter={compactNumber} sparkline={model.totalSparkline} />
            <KpiTile label="Critical & High" value={Number(model.summary.critical || 0) + Number(model.summary.high || 0)} formatter={compactNumber} sparkline={model.riskSparkline} />
            <KpiTile label="Unique Sources" value={Number(model.summary.unique_source_ips || 0)} formatter={compactNumber} sparkline={model.sourceSparkline} />
          </section>

          <div className="analytics-primary-grid">
            {model.severity.length > 0 && (
              <Card title="Severity distribution" caption="Source severity across stored alerts">
                <SeverityDistribution data={model.severity} onSelect={openSeverity} />
              </Card>
            )}
            {model.top_source_ips.length > 0 && (
              <Card title="Top source IPs" caption="Addresses producing the most alert activity">
                <RankedBarList data={model.top_source_ips} ariaLabel="Top source IPs" onSelect={openAlertSearch} />
              </Card>
            )}
            {model.top_destinations.length > 0 && (
              <Card title="Most targeted destinations" caption="Hosts, databases, and destination addresses">
                <RankedBarList data={model.top_destinations} ariaLabel="Most targeted destinations" onSelect={openAlertSearch} />
              </Card>
            )}
            {model.top_datasets.length > 0 && (
              <Card title="Telemetry sources" caption="Datasets contributing stored alerts">
                <RankedBarList data={model.top_datasets} ariaLabel="Telemetry sources" onSelect={openAlertSearch} />
              </Card>
            )}
          </div>

          {(model.mitre_tactics.length > 0 || model.top_identities.length > 0) && (
            <div className="analytics-secondary-grid">
              {model.mitre_tactics.length > 0 && (
                <Card title="ATT&CK tactic coverage" caption="Mapped tactics observed in stored evidence">
                  <RankedBarList data={model.mitre_tactics} ariaLabel="ATT&CK tactic coverage" onSelect={openAlertSearch} />
                </Card>
              )}
              {model.top_identities.length > 0 && (
                <Card title="Most exposed identities" caption="Identities ranked by total and high-risk activity">
                  <RankedBarList data={model.top_identities} ariaLabel="Most exposed identities" onSelect={openAlertSearch} />
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
