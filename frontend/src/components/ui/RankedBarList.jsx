import { cx } from './utils';

function compactNumber(value) {
  return new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(Number(value || 0));
}

export default function RankedBarList({
  data = [], valueKey = 'count', secondaryKey = 'high_risk', onSelect, ariaLabel, className,
}) {
  const maximum = Math.max(1, ...data.map(item => Number(item[valueKey] || 0)));
  return (
    <ol className={cx('ui-ranked-list', className)} aria-label={ariaLabel}>
      {data.map((item, index) => {
        const value = Number(item[valueKey] || 0);
        const secondary = item[secondaryKey];
        const content = (
          <>
            <span className="ui-ranked-label" title={item.name}>{item.name}</span>
            <span className="ui-ranked-track" aria-hidden="true"><i style={{ width:`${Math.max(2, (value / maximum) * 100)}%` }} /></span>
            <strong>{compactNumber(value)}</strong>
            {secondary != null && <small>{compactNumber(secondary)} high risk</small>}
          </>
        );
        return (
          <li key={`${item.name}-${index}`}>
            {onSelect
              ? <button type="button" onClick={() => onSelect(item)} aria-label={`Filter by ${item.name}`}>{content}</button>
              : <div>{content}</div>}
          </li>
        );
      })}
    </ol>
  );
}
