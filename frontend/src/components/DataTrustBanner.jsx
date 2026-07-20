import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import StatusBadge from './StatusBadge';

export default function DataTrustBanner({ health }) {
  if (!health) return null;
  const healthy = health.status === 'ok';
  const delayed = Object.entries(health.services || {})
    .filter(([, service]) => service?.status && service.status !== 'online')
    .map(([name]) => name.replaceAll('_', ' '));
  const source = health.source || health.services?.alert_source?.source || 'configured sources';

  return (
    <section className={`data-trust-banner ${healthy ? 'is-healthy' : 'is-degraded'}`} aria-label="Data trust and source coverage" role="status">
      {healthy ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
      <div>
        <strong>{healthy ? 'Source coverage verified' : 'Data trust requires attention'}</strong>
        <span>{healthy ? `Current views are connected to ${source}.` : delayed.length ? `Delayed or unavailable: ${delayed.join(', ')}.` : 'One or more platform dependencies are degraded.'}</span>
      </div>
      <StatusBadge tone={healthy ? 'success' : 'attention'}>{healthy ? 'Current' : 'Degraded'}</StatusBadge>
    </section>
  );
}
