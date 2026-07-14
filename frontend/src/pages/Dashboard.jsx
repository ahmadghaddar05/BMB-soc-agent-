import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api, fmtTs, sevClass } from '../lib/api';
import { AlertTriangle, ShieldCheck, ShieldX, Clock, Zap, Database, Activity } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color = 'text-white' }) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        <Icon className={`w-4 h-4 ${color} opacity-60`} />
      </div>
      <span className={`stat-value ${color}`}>{value ?? '—'}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );
}

const SEV_COLORS = { critical:'#ef4444', high:'#f97316', medium:'#eab308', low:'#22c55e', informational:'#6b7280' };

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [collector, setCollector] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [
          statsData,
          collectorData,
        ] = await Promise.all([
          api('/stats'),
          api('/collector/status'),
        ]);

        setStats(statsData);
        setCollector(collectorData);
        setErr(null);
      } catch (error) {
        setErr(error.message);
      }
    };

    loadDashboard();

    const t = setInterval(
      loadDashboard,
      15000
    );

    return () => clearInterval(t);
  }, []);

  if (err) {
    return (
      <div className="p-8 text-red-400">
        Failed to load dashboard: {err}
      </div>
    );
  }

  if (!stats || !collector) {
    return (
      <div className="p-8 text-gray-500">
        Loading…
      </div>
    );
  }

  const { alerts: a, incidents: inc, recent_runs: runs, severity_split, top_src_ips } = stats;
  const sevData = (severity_split || []).map(r => ({ sev: r.severity, n: parseInt(r.n) }));

  return (
    <div className="p-6 space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Security Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Last updated {fmtTs(new Date().toISOString())}
          </p>
        </div>
      </div>

      {/* ── Elastic collector operational status ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">
              Elastic Collector
            </h3>

            <p className="text-xs text-gray-500 mt-1">
              Reliable cursor-based alert collection
            </p>
          </div>

          <span
            className={`badge ${
              collector.collector.cycle_active
                ? 'badge-medium'
                : collector.collector.scheduler_enabled &&
                  collector.collector.scheduler_running
                ? 'badge-low'
                : 'badge-critical'
            }`}
          >
            {collector.collector.cycle_active
              ? 'Collecting'
              : collector.collector.scheduler_enabled &&
                collector.collector.scheduler_running
              ? 'Running'
              : 'Stopped'}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <div>
            <div className="text-xs text-gray-500">
              Alert Source
            </div>

            <div className="text-sm text-gray-200 mt-1 uppercase">
              {collector.collector.source}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500">
              Cursor Mode
            </div>

            <div className="text-sm text-gray-200 mt-1">
              {collector.collector.cursor_enabled
                ? 'Enabled'
                : 'Disabled'}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500">
              Collection Interval
            </div>

            <div className="text-sm text-gray-200 mt-1">
              Every {collector.collector.interval_minutes} minute
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500">
              Maximum Capacity
            </div>

            <div className="text-sm text-gray-200 mt-1">
              {collector.collector.max_alerts_per_cycle.toLocaleString()}
              {' '}alerts per cycle
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500">
              Cursor Position
            </div>

            <div className="text-xs text-blue-400 font-mono mt-1">
              {collector.collector.cursor_timestamp
                ? fmtTs(
                    collector.collector.cursor_timestamp
                  )
                : 'Not initialized'}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500">
              Stored Elastic Alerts
            </div>

            <div className="text-sm text-gray-200 mt-1">
              {collector.database.elastic_alerts.toLocaleString()}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500">
              Grouped Activities
            </div>

            <div className="text-sm text-gray-200 mt-1">
              {collector.database.grouped_activities.toLocaleString()}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500">
              Latest Run
            </div>

            <div className="text-sm text-gray-200 mt-1">
              {collector.latest_run
                ? `#${collector.latest_run.id} · ${collector.latest_run.status}`
                : 'No runs yet'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-dark-600">
          <span
            className={`badge ${
              collector.safety.triage_enabled
                ? 'badge-medium'
                : 'badge-blue'
            }`}
          >
            AI Triage:{' '}
            {collector.safety.triage_enabled
              ? 'Enabled'
              : 'Disabled'}
          </span>

          <span
            className={`badge ${
              collector.safety.elastic_writeback_enabled
                ? 'badge-medium'
                : 'badge-blue'
            }`}
          >
            Elastic Write-back:{' '}
            {collector.safety.elastic_writeback_enabled
              ? 'Enabled'
              : 'Disabled'}
          </span>

          <span
            className={`badge ${
              collector.database.missing_group_keys > 0
                ? 'badge-critical'
                : 'badge-low'
            }`}
          >
            Missing Group Keys:{' '}
            {collector.database.missing_group_keys}
          </span>

          <span
            className={`badge ${
              collector.database.enrichment_failed > 0
                ? 'badge-critical'
                : 'badge-low'
            }`}
          >
            Enrichment Failures:{' '}
            {collector.database.enrichment_failed}
          </span>
        </div>

        {collector.latest_run?.error && (
          <div className="mt-4 text-xs text-red-400">
            Last error: {collector.latest_run.error}
          </div>
        )}
      </div>

      {/* ── Elastic activity statistics ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Database}
          label="Grouped Activities"
          value={parseInt(
            a.grouped_activities || 0
          ).toLocaleString()}
          sub={`${parseInt(
            a.elastic_total || 0
          ).toLocaleString()} raw Elastic alerts`}
          color="text-blue-400"
        />

        <StatCard
          icon={AlertTriangle}
          label="Critical Activities"
          value={parseInt(
            a.critical_activities || 0
          ).toLocaleString()}
          color="text-red-400"
        />

        <StatCard
          icon={ShieldX}
          label="High Activities"
          value={parseInt(
            a.high_activities || 0
          ).toLocaleString()}
          color="text-orange-400"
        />

        <StatCard
          icon={Activity}
          label="Legacy Alerts"
          value={parseInt(
            a.legacy_total || 0
          ).toLocaleString()}
          sub="Excluded from grouped view"
          color="text-gray-400"
        />
      </div>

      {/* ── Processing and incident statistics ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={ShieldCheck}
          label="Enriched Activities"
          value={parseInt(
            a.enriched_activities || 0
          ).toLocaleString()}
          sub={`${parseInt(
            a.enrich_pending_activities || 0
          ).toLocaleString()} pending`}
          color="text-green-400"
        />

        <StatCard
          icon={Zap}
          label="AI Triaged"
          value={parseInt(
            a.triaged || 0
          ).toLocaleString()}
          sub="AI currently disabled"
          color="text-purple-400"
        />

        <StatCard
          icon={AlertTriangle}
          label="Open Incidents"
          value={inc.open}
          color="text-orange-400"
        />

        <StatCard
          icon={ShieldX}
          label="Total Incidents"
          value={inc.total}
        />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Severity distribution */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Grouped Activity Severity</h3>
          {sevData.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sevData} margin={{ top:0, right:0, left:-20, bottom:0 }}>
                <XAxis dataKey="sev" tick={{ fill:'#9ca3af', fontSize:12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill:'#9ca3af', fontSize:12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background:'#0f1623', border:'1px solid #1c2638', borderRadius:'8px' }}
                  labelStyle={{ color:'#e5e7eb' }} itemStyle={{ color:'#9ca3af' }}
                />
                <Bar dataKey="n" radius={[4,4,0,0]}>
                  {sevData.map(d => <Cell key={d.sev} fill={SEV_COLORS[d.sev] || '#6b7280'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-gray-600 text-sm py-8 text-center">No grouped Elastic activities yet</div>}
        </div>

        {/* Top source IPs */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Top Source IPs by Activity</h3>
          <div className="space-y-2">
            {(top_src_ips || []).slice(0,6).map(({ src_ip, n }) => (
              <div key={src_ip} className="flex items-center gap-3">
                <code className="text-xs text-blue-400 font-mono w-36 truncate">{src_ip}</code>
                <div className="flex-1 bg-dark-700 rounded-full h-1.5">
                  <div className="bg-accent h-1.5 rounded-full"
                    style={{ width: `${Math.min(100, parseInt(n) / (parseInt(top_src_ips[0]?.n)||1) * 100)}%` }} />
                </div>
                <span className="text-xs text-gray-500 w-8 text-right">{n}</span>
              </div>
            ))}
            {!top_src_ips?.length && <div className="text-gray-600 text-sm py-8 text-center">No data yet</div>}
          </div>
        </div>
      </div>

      {/* ── Recent runs ── */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Recent Fetch Cycles</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-dark-600">
              {['#','Started','Trigger','Fetched','Stored','Dup','Enriched','Fail','Triaged','Status'].map(h=>(
                <th key={h} className="th">{h}</th>))}
            </tr></thead>
            <tbody>
              {(runs||[]).map(run => (
                <tr key={run.id} className="table-row">
                  <td className="td text-gray-500">#{run.id}</td>
                  <td className="td text-gray-300 font-mono text-xs">{fmtTs(run.started_at)}</td>
                  <td className="td"><span className="badge-blue badge">{run.trigger}</span></td>
                  <td className="td">{run.fetched}</td>
                  <td className="td text-green-400">{run.stored}</td>
                  <td className="td text-gray-500">{run.duplicates}</td>
                  <td className="td text-blue-400">{run.enriched}</td>
                  <td className="td text-orange-400">{run.enrichment_failed}</td>
                  <td className="td text-purple-400">{run.triaged}</td>
                  <td className="td">
                    <span className={`badge ${run.status==='ok'?'badge-low':run.status==='running'?'badge-medium':'badge-critical'}`}>
                      {run.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!runs?.length && (
                <tr><td colSpan={10} className="td text-center text-gray-600 py-8">No fetch cycles yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
