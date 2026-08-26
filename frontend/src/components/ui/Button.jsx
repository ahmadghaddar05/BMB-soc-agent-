import { cx } from './utils';

export default function Button({
  variant = 'secondary', icon: Icon, iconOnly = false, className, children,
  type = 'button', as: Component = 'button', ...props
}) {
  const typeProps = Component === 'button' ? { type } : {};
  return (
    <Component className={cx('ui-button', `ui-button-${iconOnly ? 'ghost' : variant}`, iconOnly && 'ui-button-icon', className)} {...typeProps} {...props}>
      {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
      {!iconOnly && children}
    </Component>
  );
}
