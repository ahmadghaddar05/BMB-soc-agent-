import { cx } from './utils';

const LEVELS = new Set(['critical', 'high', 'medium', 'low']);

export default function SeverityBadge({ severity = 'low', className }) {
  const level = String(severity).toLowerCase();
  const safeLevel = LEVELS.has(level) ? level : 'low';
  return <span className={cx('ui-severity-badge', `ui-severity-${safeLevel}`, className)}>{safeLevel}</span>;
}
