import { useEffect, useState } from 'react';
import { api, fmtTs } from '../lib/api';
import { Save, Play, RefreshCw, Trash2, AlertCircle, CheckCircle } from 'lucide-react';

function Section({ title, children }) {
  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wide border-b border-dark-600 pb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
      <div>
        <div className="text-sm text-gray-200">{label}</div>
        {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
      </div>
      <div className="md:col-span-2">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked?'bg-accent':'bg-dark-500'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked?'translate-x-6':'translate-x-1'}`}/>
    </button>
  );
}

export default function Settings() {
  const [s,    setS]    = useState({});
  const [stats, setStats] = useState(null);
  const [sched, setSched] = useState(null);
  const [msg,  setMsg]  = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [d, sc] = await Promise.all([
      api('/settings'),
      api('/scheduler/status'),
    ]);
    setS(d.settings);
    setStats(d.stats);
    setSched(sc);
  };

  useEffect(() => { load(); const t = setInterval(load, 10000); return ()=>clearInterval(t); }, []);

  const save = async (updates) => {
    setLoading(true);
    try {
      await api('/settings', { method:'PUT', body: JSON.stringify(updates) });
      await load();
      setMsg({ type:'ok', text:'Settings saved' });
    } catch (e) {
      setMsg({ type:'err', text: e.message });
    }
    setLoading(false);
    setTimeout(()=>setMsg(null), 3000);
  };

  const field = (key) => ({
    value: s[key] || '',
    onChange: e => setS(prev => ({...prev, [key]: e.target.value})),
  });

  const toggle = (key) => ({
    checked: s[key] === 'true',
    onChange: v => setS(prev => ({...prev, [key]: v?'true':'false'})),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="text-sm text-gray-500">Automation, LLM, enrichment, and pipeline configuration</p>
        </div>
        {msg && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
            msg.type==='ok'?'bg-green-900/30 text-green-400':'bg-red-900/30 text-red-400'}`}>
            {msg.type==='ok'?<CheckCircle className="w-4 h-4"/>:<AlertCircle className="w-4 h-4"/>}
            {msg.text}
          </div>
        )}
      </div>

      {/* ── Pipeline health ── */}
      {stats && (
        <Section title="Pipeline health">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label:'Total alerts',       value: parseInt(stats.total||0).toLocaleString(), color:'text-white' },
              { label:'Enriched',           value: parseInt(stats.enriched||0).toLocaleString(), color:'text-green-400' },
              { label:'Enrich failed',      value: parseInt(stats.enrichment_failed||0).toLocaleString(), color: parseInt(stats.enrichment_failed)>0?'text-orange-400':'text-gray-400' },
              { label:'Enrich pending',     value: parseInt(stats.enrich_pending||0).toLocaleString(), color:'text-yellow-400' },
              { label:'Triaged',            value: parseInt(stats.triaged||0).toLocaleString(), color:'text-blue-400' },
              { label:'Triage failed',      value: parseInt(stats.triage_failed||0).toLocaleString(), color: parseInt(stats.triage_failed)>0?'text-red-400':'text-gray-400' },
              { label:'Auto-closed',        value: parseInt(stats.auto_closed||0).toLocaleString(), color:'text-gray-400' },
            ].map(({label,value,color})=>(
              <div key={label} className="bg-dark-700 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">{label}</div>
                <div className={`text-xl font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {(parseInt(stats.enrichment_failed)>0 || parseInt(stats.triage_failed)>0) && (
            <div className="flex gap-2 mt-2">
              {parseInt(stats.enrich_pending)>0 && (
                <button className="btn-secondary text-xs" onClick={()=>api('/scheduler/enrich-pending',{method:'POST'}).then(load)}>
                  Retry enrichment
                </button>
              )}
              {parseInt(stats.triage_pending)>0 && (
                <button className="btn-secondary text-xs" onClick={()=>api('/scheduler/triage-pending',{method:'POST'}).then(load)}>
                  Retry triage
                </button>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── Scheduler ── */}
      <Section title="Automated fetching">
        <Row label="Enable scheduler"
             hint="Automatically fetch alerts from Wazuh on a set interval">
          <Toggle {...toggle('scheduler_enabled')} />
        </Row>
        <Row label="Poll interval" hint="How often to check Wazuh">
          <select className="select w-40" {...field('interval_minutes')}>
            {[5,10,15,30].map(m=><option key={m} value={m}>{m} minutes</option>)}
          </select>
        </Row>
        <Row label="Look-back window"
             hint="How far back each query goes. Overlap with interval ensures no gaps; dedup prevents re-processing.">
          <input className="input w-40" type="number" min="1" {...field('lookback_minutes')} />
        </Row>
        <Row label="Minimum rule level" hint="0–15, Wazuh rule severity threshold">
          <input className="input w-24" type="number" min="0" max="15" {...field('min_level')} />
        </Row>
        <Row label="Alert limit per fetch" hint="Max alerts fetched per cycle">
          <input className="input w-24" type="number" min="1" max="500" {...field('limit')} />
        </Row>

        {/* Scheduler status */}
        {sched && (
          <div className="bg-dark-700 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <span className={`w-2 h-2 rounded-full ${sched.running?'bg-green-500 animate-pulse':'bg-gray-600'}`}/>
              <span className={sched.running?'text-green-400':'text-gray-400'}>
                Scheduler {sched.running?'running':'stopped'}
              </span>
              {sched.cycle_active && <span className="badge badge-medium">cycle running</span>}
            </div>
            {sched.last_run && (
              <div className="text-xs text-gray-500">Last run: {fmtTs(sched.last_run)}</div>
            )}
            <div className="flex gap-2">
              <button className="btn-primary text-xs"
                onClick={async()=>{
                  setMsg({type:'ok', text:'Running cycle…'});
                  try {
                    const r = await api('/scheduler/run-now',{method:'POST'});
                    const st = r.stats || {};
                    if (r.error) {
                      setMsg({type:'err', text:'Cycle failed: '+r.error});
                    } else {
                      setMsg({type:'ok', text:`Done — fetched ${st.fetched||0}, stored ${st.stored||0}, triaged ${st.triaged||0}, AI calls ${st.llm_calls||0}, tokens ${(st.llm_tokens||0).toLocaleString()}`});
                    }
                  } catch(e) { setMsg({type:'err', text:e.message}); }
                  await load();
                }}>
                <Play className="w-3 h-3"/> Run now
              </button>
            </div>
          </div>
        )}

        <button className="btn-primary" disabled={loading}
          onClick={()=>save({
            scheduler_enabled: s.scheduler_enabled,
            interval_minutes:  s.interval_minutes,
            lookback_minutes:  s.lookback_minutes,
            min_level:         s.min_level,
            limit:             s.limit,
          })}>
          <Save className="w-4 h-4"/> Save scheduler settings
        </button>
      </Section>

      {/* ── LLM ── */}
      <Section title="LLM / triage">
        <Row label="Provider" hint="groq = cloud, anthropic = Claude API, ollama = local">
          <select className="select w-40" {...field('llm_provider')}>
            <option value="groq">Groq</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="ollama">Ollama</option>
          </select>
        </Row>
        <Row label="Groq model" hint="Used when provider = groq">
          <input className="input w-72" placeholder="llama-3.3-70b-versatile" {...field('groq_model')} />
        </Row>
        <Row label="Anthropic model" hint="Used when provider = anthropic (e.g. claude-sonnet-4-6, claude-opus-4-8)">
          <input className="input w-72" placeholder="claude-sonnet-4-6" {...field('anthropic_model')} />
        </Row>
        <Row label="Ollama model" hint="Used when provider = ollama">
          <input className="input w-72" placeholder="llama3.1:8b" {...field('ollama_model')} />
        </Row>
        <Row label="Enable AI triage"
             hint="When disabled, collection and enrichment continue without any LLM calls">
          <Toggle {...toggle('triage_enabled')} />
        </Row>
        <Row label="Triage mode"
             hint="Hybrid screens every alert once and uses agentic tools only for ambiguous high-risk cases">
          <select className="select w-56" {...field('triage_mode')}>
            <option value="hybrid">Hybrid (recommended)</option>
            <option value="pipeline">Pipeline (fast, single call)</option>
            <option value="agentic">Agentic for every alert (expensive)</option>
          </select>
        </Row>
        <Row label="Token budget per cycle"
             hint="Stops starting new triage calls after this budget is reached; remaining alerts stay pending">
          <input className="input w-40" type="number" min="10000" max="500000" step="5000"
            placeholder="120000" {...field('triage_token_budget')} />
        </Row>
        <Row label="Agentic iterations"
             hint="Maximum investigation rounds per escalated alert (2–4; recommended 3)">
          <input className="input w-24" type="number" min="2" max="4"
            placeholder="3" {...field('agentic_max_iterations')} />
        </Row>
        <Row label="Use triage cache"
             hint="Reuses recent verdicts for genuine duplicate alert signatures">
          <Toggle {...toggle('caching_enabled')} />
        </Row>
        <Row label="Cache lifetime"
             hint="Hours before a cached verdict must be validated again">
          <input className="input w-24" type="number" min="1" max="720"
            placeholder="168" {...field('triage_cache_ttl_hours')} />
        </Row>
        <Row label="Incremental correlation"
             hint="Correlates only newly triaged alerts and relevant recent context">
          <Toggle {...toggle('correlation_enabled')} />
        </Row>
        <Row label="New alerts per correlation"
             hint="Maximum newly triaged alerts considered in one cycle">
          <input className="input w-24" type="number" min="1" max="50"
            placeholder="20" {...field('correlation_new_alerts_per_cycle')} />
        </Row>
        <Row label="Correlation token budget"
             hint="Bounds the size of the incremental correlation request">
          <input className="input w-40" type="number" min="6000" max="100000" step="1000"
            placeholder="20000" {...field('correlation_token_budget')} />
        </Row>
        <button className="btn-primary" disabled={loading}
          onClick={()=>save({
            llm_provider:s.llm_provider,
            groq_model:s.groq_model,
            anthropic_model:s.anthropic_model,
            ollama_model:s.ollama_model,
            triage_enabled:s.triage_enabled,
            triage_mode:s.triage_mode || 'hybrid',
            triage_token_budget:s.triage_token_budget || '120000',
            agentic_max_iterations:s.agentic_max_iterations || '3',
            caching_enabled:s.caching_enabled,
            triage_cache_ttl_hours:s.triage_cache_ttl_hours || '168',
            correlation_enabled:s.correlation_enabled,
            correlation_new_alerts_per_cycle:s.correlation_new_alerts_per_cycle || '20',
            correlation_token_budget:s.correlation_token_budget || '20000',
          })}>
          <Save className="w-4 h-4"/> Save AI efficiency policy
        </button>
      </Section>

      {/* ── Auto-close ── */}
      <Section title="Auto-close (noise reduction)">
        <Row label="Enable auto-close"
             hint="Automatically suppress benign alerts from the review queue">
          <Toggle {...toggle('autoclose_enabled')} />
        </Row>
        <Row label="Min confidence" hint="Only close at or above this confidence (0–1)">
          <input className="input w-28" type="number" min="0" max="1" step="0.05" {...field('autoclose_confidence')} />
        </Row>
        <Row label="Severity ceiling"
             hint="Never auto-close anything above this severity — safety guard">
          <select className="select w-40" {...field('autoclose_max_severity')}>
            {['informational','low','medium','high','critical'].map(s=>(
              <option key={s} value={s}>{s}</option>))}
          </select>
        </Row>
        <Row label="Eligible verdicts" hint="Comma-separated list">
          <input className="input w-72" placeholder="false_positive,benign_anomaly"
            {...field('autoclose_verdicts')} />
        </Row>
        <button className="btn-primary" disabled={loading}
          onClick={()=>save({
            autoclose_enabled:      s.autoclose_enabled,
            autoclose_confidence:   s.autoclose_confidence,
            autoclose_max_severity: s.autoclose_max_severity,
            autoclose_verdicts:     s.autoclose_verdicts,
          })}>
          <Save className="w-4 h-4"/> Save auto-close policy
        </button>
      </Section>

      {/* ── Fetch history ── */}
      {sched?.recent_runs?.length > 0 && (
        <Section title="Recent fetch cycles">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-dark-600">
                {['#','Started','Trigger','Fetched','Stored','Dup','Enriched','Enr Fail','Triaged','Tri Fail','Status'].map(h=>(
                  <th key={h} className="th">{h}</th>))}
              </tr></thead>
              <tbody>
                {sched.recent_runs.map(run=>(
                  <tr key={run.id} className="table-row">
                    <td className="td text-gray-500">#{run.id}</td>
                    <td className="td font-mono">{fmtTs(run.started_at)}</td>
                    <td className="td"><span className="badge badge-blue">{run.trigger}</span></td>
                    <td className="td">{run.fetched}</td>
                    <td className="td text-green-400">{run.stored}</td>
                    <td className="td text-gray-500">{run.duplicates}</td>
                    <td className="td text-blue-400">{run.enriched}</td>
                    <td className={`td ${run.enrichment_failed>0?'text-orange-400':'text-gray-500'}`}>{run.enrichment_failed}</td>
                    <td className="td text-purple-400">{run.triaged}</td>
                    <td className={`td ${run.triage_failed>0?'text-red-400':'text-gray-500'}`}>{run.triage_failed}</td>
                    <td className="td">
                      <span className={`badge ${run.status==='ok'?'badge-low':run.status==='running'?'badge-medium':'badge-critical'}`}>
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
