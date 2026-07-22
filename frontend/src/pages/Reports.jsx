import { useState } from 'react';
import { FileText, Download, AlertTriangle, Bell } from 'lucide-react';
import { ROLES } from '../lib/roles';

// Reports are file downloads streamed by the API; opening the URL triggers the
// browser's download (the endpoint sets Content-Disposition: attachment).
function download(path) {
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Reports({ role }) {
  const [hours, setHours] = useState('24');
  const [incId, setIncId] = useState('');

  const range = hours === 'all' ? '' : `?hours=${hours}`;
  const sep = range ? '&' : '?';
  const executive = role === ROLES.EXECUTIVE;

  return (
    <div className="space-y-6">
      <div>
          <h1 className="page-title">{executive ? 'Executive Reports' : 'Reports'}</h1>
          <p className="text-sm text-gray-500">{executive ? 'Generate decision-level security summaries without raw alert evidence.' : 'Generate PDF reports for alerts and incidents.'}</p>
      </div>

      {/* Alerts reports */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-accent" />
          <h2 className="text-base font-semibold text-white">Alerts report</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm text-gray-400">Time range</label>
          <select className="select w-40" value={hours} onChange={e => setHours(e.target.value)}>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="btn-secondary" onClick={() => download(`/reports/alerts${range}`)}>
            <FileText className="w-4 h-4" /> Summary PDF
          </button>
          {!executive && <button className="btn-primary" onClick={() => download(`/reports/alerts${range}${sep}detailed=true`)}>
            <Download className="w-4 h-4" /> Detailed PDF
          </button>}
        </div>
        <p className="text-xs text-gray-600">
          {executive ? 'Summary includes aggregate severity and outcome trends. Raw alert rows are restricted to SOC roles.' : 'Summary = severity / verdict / MITRE breakdown. Detailed = full alert table.'}
        </p>
      </div>

      {/* Incidents reports */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-accent" />
          <h2 className="text-base font-semibold text-white">Incidents report</h2>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="btn-secondary" onClick={() => download('/reports/incidents')}>
            <FileText className="w-4 h-4" /> Summary PDF
          </button>
          {!executive && <button className="btn-primary" onClick={() => download('/reports/incidents?detailed=true')}>
            <Download className="w-4 h-4" /> Detailed PDF
          </button>}
        </div>
        <p className="text-xs text-gray-600">
          {executive ? 'Summary includes incident status and risk distribution. Detailed member evidence is restricted to SOC roles.' : <>Summary = status / severity breakdown + index. Detailed = every open incident with narrative,
          attack stages, member alerts and recommended actions.</>}
        </p>

        {!executive && <div className="border-t border-dark-600 pt-4">
          <div className="text-sm text-gray-400 mb-2">Single incident report</div>
          <div className="flex gap-3 items-center flex-wrap">
            <input className="input w-32" placeholder="Incident ID" value={incId}
              onChange={e => setIncId(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-secondary" disabled={!incId}
              onClick={() => download(`/reports/incidents/${incId}`)}>
              <Download className="w-4 h-4" /> Generate
            </button>
          </div>
        </div>}
      </div>
    </div>
  );
}
