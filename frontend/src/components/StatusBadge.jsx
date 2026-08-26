export default function StatusBadge({ tone = 'neutral', children, className = '' }) {
  const status = {
    success: 'resolved',
    attention: 'degraded',
    critical: 'error',
  }[tone] || tone;
  return <span className={`ui-status-chip ui-status-${status} status-badge ${className}`.trim()}>{children}</span>;
}
