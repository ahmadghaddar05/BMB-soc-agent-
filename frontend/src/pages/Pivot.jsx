import { useState } from 'react';
import { api, fmtTs, sevClass } from '../lib/api';
import { Search } from 'lucide-react';

export default function Pivot() {
  const [indicator, setIndicator] = useState('');
  const [result, setResult]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const search = async () => {
    if (!indicator.trim()) return;
    setLoading(true); setError(null);
    try {
      const d = await api(`/pivot?indicator=${encodeURIComponent(indicator.trim())}`);
      setResult(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const tipColor = result?.threat_intel?.found ? {
    critical:'text-red-400', high:'text-orange-400', medium:'text-yellow-400'
  }[result.threat_intel.severity] || 'text-gray-300' : 'text-green-400';

  return (
    <div className="p-6 space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">IOC Pivot / Sweep</h1>
          <p className="text-sm text-gray-500">Search for an IP, username, or hostname across all alerts and incidents</p>
        </div>
      </div>

      {/* Search */}
      <div className="card">
        <div className="flex gap-3">
          <input className="input flex-1" placeholder="IP address, username, or hostname…"
            value={indicator} onChange={e=>setIndicator(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&search()} />
          <button className="btn-primary" onClick={search} disabled={loading}>
            <Search className="w-4 h-4" />
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
      </div>

      {result && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="stat-card">
              <span className="stat-label">Matching Alerts</span>
              <span className="stat-value text-orange-400">{result.alert_count}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Related Incidents</span>
              <span className="stat-value text-purple-400">{result.incident_count}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Threat Intel</span>
              <span className={`stat-value text-2xl ${tipColor}`}>
                {result.threat_intel?.found
                  ? result.threat_intel.severity?.toUpperCase()
                  : 'CLEAN'}
              </span>
            </div>
          </div>

          {/* TIP details */}
          {result.threat_intel?.found && (
            <div className="card border-red-900">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="font-semibold text-red-300 mb-1">Threat Intelligence Match</div>
                  <div className="text-sm text-gray-300">{result.threat_intel.notes}</div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {result.threat_intel.categories?.map(c=>(
                      <span key={c} className="badge badge-critical">{c}</span>
                    ))}
                    {result.threat_intel.sources?.map(s=>(
                      <span key={s} className="badge badge-info">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>Confidence: {result.threat_intel.confidence}</div>
                  <div>TLP: {result.threat_intel.tlp}</div>
                  <div>Last seen: {fmtTs(result.threat_intel.last_seen)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Related incidents */}
          {result.incidents?.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Related Incidents</h3>
              <div className="space-y-2">
                {result.incidents.map(inc=>(
                  <div key={inc.id} className="flex items-center gap-3 bg-dark-700 rounded-lg p-3">
                    <span className={`badge ${sevClass(inc.severity)}`}>{inc.severity}</span>
                    <span className="text-sm text-gray-200 flex-1">{inc.title}</span>
                    <span className={`badge ${inc.status==='open'?'badge-medium':'badge-low'}`}>{inc.status}</span>
                    <span className="text-xs text-gray-500">{fmtTs(inc.last_seen)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matching alerts */}
          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-dark-600 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-300">Matching Alerts ({result.alert_count})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-dark-700 border-b border-dark-600">
                  <th className="th">Time</th><th className="th">Lvl</th><th className="th">Rule</th>
                  <th className="th">Src IP</th><th className="th">User</th><th className="th">Host</th>
                  <th className="th">Verdict</th>
                </tr></thead>
                <tbody>
                  {result.alerts?.map(a => {
                    const v = a.verdict ? (typeof a.verdict==='string'?JSON.parse(a.verdict):a.verdict) : null;
                    return (
                      <tr key={a.id} className="table-row">
                        <td className="td font-mono text-xs text-gray-500">{fmtTs(a.timestamp)}</td>
                        <td className="td">{a.rule_level}</td>
                        <td className="td text-gray-300 max-w-xs truncate">{a.rule_desc}</td>
                        <td className="td font-mono text-xs text-blue-400">{a.src_ip||'—'}</td>
                        <td className="td text-xs">{a.username||'—'}</td>
                        <td className="td text-xs">{a.agent_name||'—'}</td>
                        <td className="td">{v?<span className={`badge ${sevClass(v.severity)}`}>{v.severity}</span>:'—'}</td>
                      </tr>
                    );
                  })}
                  {!result.alerts?.length && (
                    <tr><td colSpan={7} className="td text-center text-gray-600 py-8">No matching alerts</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
