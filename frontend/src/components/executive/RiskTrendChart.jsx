import { TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { asNumber } from '../../lib/executive';

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return <div className="rounded-xl border border-[#2a4c66] bg-[#091722]/95 px-3.5 py-3 text-xs shadow-xl"><strong className="block text-[#e9f2f8]">{label}</strong><span className="mt-2 block text-[#8ea5b7]">Incoming risk index <b className="text-[#58c8f4]">{point.score}/100</b></span><span className="mt-1 block text-[#8098aa]">{asNumber(point.critical)} critical · {asNumber(point.high)} high</span></div>;
}

export default function RiskTrendChart({ data = [], windowDays = 30 }) {
  const chartData = data.map(point => {
    const rawScore = point.score ?? point.risk_score ?? point.exposure;
    const numericScore = rawScore == null ? null : Number(rawScore);
    return {
      ...point,
      score:Number.isFinite(numericScore) ? Math.max(0, Math.min(100, Math.round(numericScore))) : null,
      label:new Date(point.date || point.bucket).toLocaleDateString(undefined, { month:'short', day:'numeric' }),
    };
  });
  const measured = chartData.filter(point => Number.isFinite(point.score));
  const first = measured[0]?.score;
  const last = measured.at(-1)?.score;
  const delta = Number.isFinite(first) && Number.isFinite(last) ? last - first : null;
  const improving = delta != null && delta <= 0;
  const average = measured.length ? Math.round(measured.reduce((sum, item) => sum + item.score, 0) / measured.length) : null;

  return (
    <section className="rounded-2xl border border-[#1d374b] bg-[#0b1722] p-5 shadow-[0_18px_45px_rgba(0,0,0,.14)] md:p-6" aria-labelledby="risk-trend-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#8098aa]">Macro threat landscape</p><h2 id="risk-trend-title" className="mt-1.5 text-lg font-semibold tracking-[-.02em] text-[#f0f6fa]">Incoming Risk Trend</h2><p className="mt-1 text-sm text-[#8098aa]">Daily severity, backlog, and newly correlated risk over the last {windowDays} days. Gaps mean no telemetry; lower is better.</p></div>
        {delta != null && <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${improving ? 'border-[#33d69f]/30 bg-[#33d69f]/[.07] text-[#50dcae]' : 'border-[#f7b955]/30 bg-[#f7b955]/[.07] text-[#f7c66d]'}`}>{improving ? <TrendingDown size={14} /> : <TrendingUp size={14} />}{Math.abs(delta)} points {improving ? 'lower' : 'higher'}</div>}
      </div>

      {measured.length ? <>
        <div className="mt-5 h-[285px] w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top:8, right:8, left:-24, bottom:0 }}>
              <defs><linearGradient id="executiveRiskFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#36c5f0" stopOpacity={0.32} /><stop offset="100%" stopColor="#4c9aff" stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid stroke="#1a3346" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" stroke="#8098aa" axisLine={false} tickLine={false} tick={{ fontSize:11 }} minTickGap={24} />
              <YAxis domain={[0,100]} ticks={[0,25,50,75,100]} stroke="#8098aa" axisLine={false} tickLine={false} tick={{ fontSize:11 }} />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke:'#355a75', strokeDasharray:'4 4' }} />
              <Area type="monotone" dataKey="score" name="Incoming risk" stroke="#43bdf2" strokeWidth={2.4} fill="url(#executiveRiskFill)" connectNulls={false} activeDot={{ r:4, fill:'#07111b', stroke:'#5bd4ff', strokeWidth:2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="sr-only">Average incoming risk was {average} out of 100 across {measured.length} measured days. The first measured day was {first} and the last was {last}, a {Math.abs(delta)} point {improving ? 'improvement' : 'increase'}. Missing days indicate unavailable telemetry.</p>
      </> : <div className="mt-5 grid h-[285px] place-items-center rounded-xl border border-dashed border-[#244159] bg-[#09151f]"><div className="max-w-sm text-center"><strong className="text-sm text-[#c3d3de]">No historical risk telemetry yet</strong><p className="mt-2 text-xs leading-5 text-[#7891a5]">The chart will populate after stored Elastic activity covers this reporting window.</p></div></div>}
    </section>
  );
}
