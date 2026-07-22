import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, BrainCircuit, Check, CircleAlert, RefreshCw, ShieldCheck, Sparkles, WandSparkles } from 'lucide-react';
import { api, sevClass, verdictLabel } from '../lib/api';
import { parseJson, severityOf, entityOf, relativeTime } from '../lib/soc';

export default function AITriage() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: 50 });
      if (status) query.set('triage_status', status);
      const [alerts, summary] = await Promise.all([api(`/alerts?${query}`), api('/stats')]);
      setRows(alerts.alerts || []);
      setStats(summary.alerts || {});
      setSelected(current => current.filter(id => (alerts.alerts || []).some(row => row.id === id)));
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const selectedRows = useMemo(() => rows.filter(row => selected.includes(row.id)), [rows, selected]);

  function toggle(id) {
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  async function runSelected() {
    if (!selectedRows.length) return;
    setRunning(true); setMessage('');
    try {
      for (const row of selectedRows) await api(`/alerts/${encodeURIComponent(row.id)}/retriage`, { method: 'POST' });
      setMessage(`${selectedRows.length} alert${selectedRows.length === 1 ? '' : 's'} sent through AI triage.`);
      setSelected([]);
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setRunning(false); }
  }

  async function runPending() {
    setRunning(true); setMessage('');
    try {
      const result = await api('/scheduler/triage-pending', { method: 'POST' });
      setMessage(`Triage cycle complete: ${result.triaged || 0} triaged, ${result.failed || 0} failed.`);
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setRunning(false); }
  }

  const metrics = [
    ['Awaiting AI', stats?.triage_pending ?? stats?.pending ?? 0, BrainCircuit, 'blue'],
    ['Triaged', stats?.triaged ?? 0, ShieldCheck, 'green'],
    ['Triage failures', stats?.triage_failed ?? 0, CircleAlert, 'red'],
    ['Auto-closed', stats?.auto_closed ?? 0, Check, 'purple'],
  ];

  return <div className="module-page triage-console">
    <div className="module-hero compact">
      <div><span className="eyebrow"><Sparkles />AI decision operations</span><h2>AI Triage Console</h2><p>Prioritize, explain, and reprocess security alerts with the configured SOC model.</p></div>
      <div className="hero-actions"><button className="ghost-action" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button><button className="primary-action" onClick={runPending} disabled={running}><WandSparkles />Run pending queue</button></div>
    </div>

    <div className="module-metrics">{metrics.map(([label, value, Icon, tone]) => <article key={label} className={`metric-card tone-${tone}`}><span><Icon /></span><div><small>{label}</small><strong>{Number(value || 0).toLocaleString()}</strong></div></article>)}</div>

    {message && <div className="module-notice">{message}</div>}

    <section className="module-panel">
      <div className="panel-heading"><div><Bot /><span><strong>Model work queue</strong><small>Every row is backed by a stored Elastic alert</small></span></div><div className="segmented">{[['pending','Pending'],['triaged','Triaged'],['triage_failed','Failed'],['','All']].map(([value,label]) => <button key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}</button>)}</div></div>
      <div className="batch-bar"><span>{selected.length} selected</span><button onClick={() => setSelected(rows.map(row => row.id))}>Select page</button><button onClick={() => setSelected([])}>Clear</button><button className="primary-action small" disabled={!selected.length || running} onClick={runSelected}><Sparkles />Re-run selected</button></div>
      <div className="module-table-wrap"><table className="module-table"><thead><tr><th></th><th>Alert</th><th>Entity</th><th>Source severity</th><th>AI decision</th><th>Confidence</th><th>State</th><th>Observed</th></tr></thead><tbody>{rows.map(row => {
        const verdict = parseJson(row.verdict); const confidence = verdict.confidence == null ? null : Math.round(verdict.confidence * 100);
        return <tr key={row.id} className={selected.includes(row.id) ? 'selected' : ''}><td><button className={`row-check ${selected.includes(row.id) ? 'checked' : ''}`} onClick={() => toggle(row.id)}>{selected.includes(row.id) && <Check />}</button></td><td><strong>{row.rule_desc || 'Security alert'}</strong><small>{row.id}</small></td><td><strong>{entityOf(row)}</strong><small>{row.username || row.src_ip || 'No secondary entity'}</small></td><td><span className={`badge ${sevClass(severityOf(row))}`}>{severityOf(row)}</span></td><td>{verdict.verdict ? verdictLabel(verdict.verdict) : 'Awaiting model'}</td><td>{confidence == null ? '—' : <span className="confidence-cell"><i><b style={{width:`${confidence}%`}} /></i>{confidence}%</span>}</td><td><span className={`state-dot state-${row.triage_status}`}>{row.triage_status || 'pending'}</span></td><td>{relativeTime(row.timestamp)}</td></tr>;
      })}</tbody></table>{!loading && !rows.length && <div className="module-empty"><BrainCircuit /><strong>No alerts in this queue</strong><span>Choose another state or run the next collection cycle.</span></div>}</div>
    </section>
  </div>;
}
