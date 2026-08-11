import { cx } from './utils';

export default function UnderlineTabs({ value, options, onChange, label = 'Workspace sections', className }) {
  const activeIndex = Math.max(0, options.findIndex(option => option.value === value));
  return (
    <div
      className={cx('ui-underline-tabs', className)}
      role="tablist"
      aria-label={label}
      style={{ '--tab-count': options.length, '--tab-index': activeIndex }}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
