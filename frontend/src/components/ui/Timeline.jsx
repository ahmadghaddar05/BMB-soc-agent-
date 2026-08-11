import { cx } from './utils';

export default function Timeline({ items = [], className }) {
  return (
    <ol className={cx('ui-timeline', className)}>
      {items.map((item, index) => (
        <li key={item.id || `${item.title}-${index}`} style={{ '--timeline-index': Math.min(index, 6) }}>
          <span className="ui-timeline-marker" aria-hidden="true">{item.icon || null}</span>
          <div><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}{item.meta && <small>{item.meta}</small>}</div>
        </li>
      ))}
    </ol>
  );
}
