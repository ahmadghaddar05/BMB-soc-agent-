import { cx } from './utils';

export default function Timeline({ items = [], className }) {
  return (
    <ol className={cx('ui-timeline', className)}>
      {items.map((item, index) => (
        <li key={item.id || `${item.title}-${index}`} style={{ '--timeline-index': Math.min(index, 6) }}>
          <span className="ui-timeline-marker" aria-hidden="true">{item.icon || null}</span>
          <div className="ui-timeline-content">
            <div className="ui-timeline-title"><strong>{item.title}</strong>{item.meta && <small>{item.statusIcon}{item.meta}</small>}</div>
            {item.detail && <p>{item.detail}</p>}
            {item.expandedContent && (
              <details className="ui-timeline-disclosure">
                <summary>{item.expandedLabel || 'Recorded details'}</summary>
                <div>{item.expandedContent}</div>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
