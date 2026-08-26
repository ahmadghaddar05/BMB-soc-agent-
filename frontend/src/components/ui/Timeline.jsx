import { useEffect, useRef } from 'react';
import { cx } from './utils';

const SEVERITY_TONES = new Set(['critical', 'high', 'medium', 'low']);

function itemTone(item) {
  if (item.tone === 'success') return 'success';
  return SEVERITY_TONES.has(item.severity) ? item.severity : null;
}

export default function Timeline({
  items = [],
  className,
  ariaLabel = 'Event timeline',
  live = false,
  autoScroll = false,
}) {
  const endRef = useRef(null);

  useEffect(() => {
    if (!autoScroll || items.length === 0) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const endElement = endRef.current;
    if (typeof endElement?.scrollIntoView === 'function') {
      endElement.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, [autoScroll, items.length]);

  return (
    <ol
      className={cx('ui-timeline', className)}
      aria-label={ariaLabel}
      aria-live={live ? 'polite' : undefined}
      aria-relevant={live ? 'additions' : undefined}
      aria-atomic={live ? 'false' : undefined}
      role={live ? 'log' : undefined}
    >
      {items.map((item, index) => {
        const tone = itemTone(item);
        return (
        <li
          key={item.id || `${item.title}-${index}`}
          id={item.domId || undefined}
          ref={index === items.length - 1 ? endRef : undefined}
          className={cx(tone && `ui-timeline-tone-${tone}`, item.final && 'is-final', item.className)}
          data-event-type={item.eventType || undefined}
          style={{ '--timeline-index': Math.min(index, 6) }}
        >
          <span className="ui-timeline-marker" aria-hidden="true">{item.icon || null}</span>
          <div className="ui-timeline-content">
            {item.timestamp && <time className="ui-timeline-time" dateTime={item.dateTime || item.timestamp}>{item.timestamp}</time>}
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
        );
      })}
    </ol>
  );
}
