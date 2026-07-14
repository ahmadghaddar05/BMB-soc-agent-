import { useEffect, useState } from 'react';
import { api, fmtTs, sevClass } from '../lib/api';
import { RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

const MITRE_TACTICS = {
  reconnaissance:'Recon', resource_development:'Res Dev', initial_access:'Init Access',
  execution:'Execution', persistence:'Persistence', privilege_escalation:'Priv Escal',
  defense_evasion:'Def Evasion', credential_access:'Cred Access', discovery:'Discovery',
  lateral_movement:'Lateral Mvmt', collection:'Collection', command_and_control:'C2',
  exfiltration:'Exfil', impact:'Impact', unknown:'Unknown',
};

// 14-cell ATT&CK matrix
const TACTIC_ORDER = Object.keys(MITRE_TACTICS);
function MitreMatrix({ stages }) {
  const hitSet = new Set(stages || []);
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {TACTIC_ORDER.map(t => (
        <span key={t}
          className={`text-xs px-2 py-0.5 rounded border ${hitSet.has(t)
            ? 'bg-blue-900/40 text-blue-300 border-blue-700 font-medium'
            : 'bg-dark-700 text-gray-600 border-dark-600'}`}
          title={t.replace(/_/g,' ')}>
          {MITRE_TACTICS[t]}
        </span>
      ))}
    </div>
  );
}

function IncidentRow({ inc, onStatusChange }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const loadDetail = async () => {
    if (!open) {
      const d = await api(`/incidents/${inc.id}`);
      setDetail(d);
    }
    setOpen(o => !o);
  };

  return (
    <>
      <tr className="table-row cursor-pointer" onClick={loadDetail}>
        <td className="td w-8">{open ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}</td>
        <td className="td"><span className={`badge ${sevClass(inc.severity)}`}>{inc.severity||'?'}</span></td>
        <td className="td text-gray-200 font-medium max-w-xs">{inc.title||'Untitled Incident'}
          {inc.incident_type==='triage'
            ? <span className="badge badge-info ml-2 text-[10px]">single</span>
            : <span className="badge badge-blue ml-2 text-[10px]">correlated</span>}
        </td>
        <td className="td"><span className="font-mono text-xs text-gray-400">{inc.alert_ids?.length||0} alerts</span></td>
        <td className="td text-xs text-gray-400">
          {(inc.attack_stages||[]).slice(0,3).map(s => (
            <span key={s} className="badge badge-blue mr-1">{MITRE_TACTICS[s]||s}</span>
          ))}
        </td>
        <td className="td"><span className={`badge ${
          inc.status==='open'?'badge-medium':inc.status==='closed'?'badge-low':'badge-info'}`}>
          {inc.status}</span></td>
        <td className="td font-mono text-xs text-gray-500">{fmtTs(inc.last_seen)}</td>
      </tr>

      {open && detail && (
        <tr className="bg-dark-700/40">
          <td colSpan={7} className="px-6 py-5">
            <div className="space-y-4">
              {/* Narrative */}
              <p className="text-sm text-gray-300">{detail.narrative}</p>

              {/* MITRE chain */}
              <div>
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">ATT&CK Coverage</div>
                <MitreMatrix stages={detail.attack_stages} />
              </div>

              {/* Entities */}
              {detail.common_entities && Object.keys(detail.common_entities).length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Shared Entities</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(detail.common_entities).flatMap(([k,vs]) =>
                      (vs||[]).map(v => (
                        <span key={`${k}:${v}`} className="badge badge-blue">
                          <span className="text-gray-500">{k}:</span> {v}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              {detail.recommended_actions?.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Recommended Actions</div>
                  <ul className="text-sm text-yellow-300 list-disc list-inside space-y-1">
                    {detail.recommended_actions.map((a,i)=><li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              {/* Alerts table */}
              {detail.alerts?.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Evidence ({detail.alerts.length} alerts)</div>
                  <div className="overflow-x-auto rounded border border-dark-600">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-dark-700">
                        <th className="th">Time</th><th className="th">Lvl</th>
                        <th className="th">Rule</th><th className="th">Src IP</th>
                        <th className="th">User</th><th className="th">Host</th>
                      </tr></thead>
                      <tbody>
                        {detail.alerts.map(a=>(
                          <tr key={a.id} className="border-b border-dark-600 last:border-0">
                            <td className="td font-mono">{fmtTs(a.timestamp)}</td>
                            <td className="td">{a.rule_level}</td>
                            <td className="td truncate max-w-xs" title={a.rule_desc}>{a.rule_desc}</td>
                            <td className="td font-mono text-blue-400">{a.src_ip||'—'}</td>
                            <td className="td">{a.username||'—'}</td>
                            <td className="td">{a.agent_name||a.hostname?.split('.')[0]||'—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Status buttons */}
              <div className="flex gap-2 pt-2 border-t border-dark-600">
                <span className="text-xs text-gray-500 self-center">Update status:</span>
                {['open','closed','false_positive'].map(s=>(
                  <button key={s}
                    className={`btn-secondary text-xs ${inc.status===s?'border-accent text-accent':''}`}
                    onClick={()=>onStatusChange(inc.id,s)}>
                    {s.replace(/_/g,' ')}
                  </button>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [total, setTotal]         = useState(0);
  const [status, setStatus]       = useState('open');
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api(`/incidents?status=${status}&page=${page}&limit=20`);
      setIncidents(d.incidents);
      setTotal(d.total);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [status, page]);

  const handleStatusChange = async (id, newStatus) => {
    await api(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">Incidents</h1>
          <p className="text-sm text-gray-500">{total} {status}</p>
        </div>
        <div className="flex gap-2">
          {['open','closed','false_positive'].map(s => (
            <button key={s}
              className={status===s?'btn-primary':'btn-secondary'}
              onClick={() => { setStatus(s); setPage(1); }}>
              {s.replace(/_/g,' ')}
            </button>
          ))}
          <button className="btn-ghost" onClick={load}>
            <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />
          </button>
        </div>
      </div>

      {!incidents.length && !loading && (
        <div className="card flex flex-col items-center py-16 text-gray-600">
          <AlertTriangle className="w-10 h-10 mb-3 opacity-30" />
          <p>No {status} incidents</p>
        </div>
      )}

      {incidents.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-dark-700 border-b border-dark-600">
              <th className="th w-8"></th>
              <th className="th">Severity</th>
              <th className="th">Title</th>
              <th className="th">Alerts</th>
              <th className="th">ATT&CK Stages</th>
              <th className="th">Status</th>
              <th className="th">Last Seen</th>
            </tr></thead>
            <tbody>
              {incidents.map(inc => (
                <IncidentRow key={inc.id} inc={inc} onStatusChange={handleStatusChange} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
