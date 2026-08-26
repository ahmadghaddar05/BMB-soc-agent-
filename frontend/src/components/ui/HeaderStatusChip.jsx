import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const DISMISS_KEY = 'bmb-health-chip-collapsed';

export default function HeaderStatusChip({ health }) {
  const [collapsed, setCollapsed] = useState(() => globalThis.sessionStorage?.getItem(DISMISS_KEY) === '1');
  if (!health || health.status === 'ok') return null;
  const delayed = Object.entries(health.services || {})
    .filter(([, service]) => service?.status && service.status !== 'online')
    .map(([name]) => name.replaceAll('_', ' '));
  const message = delayed.length ? `${delayed.join(', ')} unavailable` : 'Platform health degraded';

  if (collapsed) {
    return <span className="ui-header-health is-collapsed" title={message} aria-label={message}><AlertTriangle size={16} strokeWidth={1.5} /></span>;
  }
  return (
    <span className="ui-header-health" role="status">
      <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
      <span>{message}</span>
      <button type="button" aria-label="Collapse platform warning" onClick={() => { globalThis.sessionStorage?.setItem(DISMISS_KEY, '1'); setCollapsed(true); }}><X size={16} strokeWidth={1.5} /></button>
    </span>
  );
}
