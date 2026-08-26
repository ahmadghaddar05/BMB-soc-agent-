import { ChevronDown } from 'lucide-react';
import { cx } from './utils';

export default function Select({ label, className, children, ...props }) {
  return (
    <label className={cx('ui-select-field', className)}>
      {label && <span>{label}</span>}
      <span className="ui-select-control">
        <select {...props}>{children}</select>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </span>
    </label>
  );
}
