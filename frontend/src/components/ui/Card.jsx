import { cx } from './utils';

export default function Card({ title, caption, action, compact = false, className, children, as: Component = 'section', ...props }) {
  return (
    <Component className={cx('ui-card', compact && 'ui-card-compact', className)} {...props}>
      {(title || action) && (
        <header className="ui-card-header">
          <div>
            {title && <h2>{title}</h2>}
            {caption && <p>{caption}</p>}
          </div>
          {action && <div className="ui-card-action">{action}</div>}
        </header>
      )}
      {children}
    </Component>
  );
}
