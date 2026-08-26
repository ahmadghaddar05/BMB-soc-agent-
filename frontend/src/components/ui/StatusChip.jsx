import { cx } from './utils';

export default function StatusChip({ status = 'neutral', children, className }) {
  return <span className={cx('ui-status-chip', `ui-status-${status}`, className)}>{children ?? status}</span>;
}
