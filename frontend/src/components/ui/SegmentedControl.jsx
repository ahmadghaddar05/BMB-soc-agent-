import { cx } from './utils';

export default function SegmentedControl({ value, options, onChange, label, className }) {
  return (
    <div className={cx('ui-segmented', className)} role="group" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
