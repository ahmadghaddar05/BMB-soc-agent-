import { Activity, AlertOctagon, Clock3 } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';

function Sparkline({ data, dataKey, color }) {
  const hasData = data.some(item => item[dataKey] != null);
  if (!hasData) return <div className="grid h-20 place-items-center rounded-lg border border-dashed border-[#27445a] text-[11px] text-[#607c92]">No trustworthy series</div>;
  return <div className="h-20" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top:8, right:2, bottom:2, left:2 }}><defs><linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity=".02" /></linearGradient></defs><Tooltip contentStyle={{ background:'#071521', border:'1px solid #29465d', borderRadius:8, fontSize:11 }} labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ''} /><Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#fill-${dataKey})`} connectNulls={false} /></AreaChart></ResponsiveContainer></div>;
}

function TrendCard({ icon:Icon, title, value, unit, data, dataKey, color, detail, unavailable }) {
  return <article className="rounded-xl border border-[#143047] bg-[#071521] p-4"><div className="flex items-start justify-between gap-3"><div><span className="flex items-center gap-2 text-xs font-semibold text-[#9cb2c2]"><Icon size={14} style={{ color }} />{title}</span><strong className="mt-2 block text-2xl font-semibold tabular-nums text-[#edf5fa]">{unavailable ? '—' : value}<small className="ml-1 text-xs font-medium text-[#668299]">{unit}</small></strong></div></div><div className="mt-2"><Sparkline data={unavailable ? [] : data} dataKey={dataKey} color={color} /></div><p className="mt-2 min-h-8 text-[11px] leading-4 text-[#607c92]">{detail}</p></article>;
}

export default function RiskTrendChart({ data = [], windowDays = 30 }) {
  const chartData = data.map(point => ({
    ...point,
    label:new Date(point.date).toLocaleDateString(undefined, { month:'short', day:'numeric' }),
    exposure:point.risk_score == null ? null : Number(point.risk_score),
    criticalIncidents:Number(point.critical_incidents_created || 0),
    responseTime:null,
  }));
  const measured = chartData.filter(item => item.exposure != null);
  const latestExposure = measured.at(-1)?.exposure ?? '—';
  const criticalTotal = chartData.reduce((sum, item) => sum + item.criticalIncidents, 0);
  return (
    <section className="rounded-2xl border border-[#17334a] bg-[#081725] p-5" aria-labelledby="executive-trends-title">
      <div><p className="text-xs font-semibold text-[#7891a5]">Change over time</p><h2 id="executive-trends-title" className="mt-1 text-lg font-semibold text-[#edf5fa]">Exposure and incident trends</h2><p className="mt-1 text-xs text-[#668299]">Last {windowDays} days. Missing telemetry remains visible as a gap.</p></div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <TrendCard icon={Activity} title="Risk exposure" value={latestExposure} unit="/100" data={chartData} dataKey="exposure" color="#3988ff" detail="Derived daily from severity, open-risk pressure, and pending triage. Lower is better." />
        <TrendCard icon={AlertOctagon} title="Critical incidents created" value={criticalTotal} unit={`in ${windowDays}d`} data={chartData} dataKey="criticalIncidents" color="#ef4453" detail="New critical incident records created during the reporting window." />
        <TrendCard icon={Clock3} title="Response time" value="—" unit="hours" data={chartData} dataKey="responseTime" color="#f2c94c" unavailable detail="Unavailable: acknowledgement and response milestone timestamps are not stored." />
      </div>
    </section>
  );
}
