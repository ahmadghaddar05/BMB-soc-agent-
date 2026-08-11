import { cx } from './utils';

export default function Button({ variant = 'secondary', icon: Icon, iconOnly = false, className, children, type = 'button', ...props }) {
  return (
    <button type={type} className={cx('ui-button', `ui-button-${iconOnly ? 'ghost' : variant}`, iconOnly && 'ui-button-icon', className)} {...props}>
      {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
      {!iconOnly && children}
    </button>
  );
}
