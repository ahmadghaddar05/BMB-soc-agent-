import { cx } from './utils';

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : null;
}

export default function ConfidenceGauge({ value, label = 'Awaiting triage', className }) {
  const confidence = clamp(value);
  const pending = confidence == null;
  const tone = pending ? 'pending' : confidence >= 70 ? 'confident' : confidence >= 40 ? 'review' : 'low';
  const circumference = 276.46;
  const offset = pending ? circumference : circumference * (1 - confidence / 100);

  return (
    <figure
      className={cx('ui-confidence-gauge', `ui-confidence-${tone}`, className)}
      role="img"
      aria-label={pending ? `${label}. Confidence is not available yet.` : `${label}. ${confidence}% model confidence.`}
    >
      <svg viewBox="0 0 112 112" aria-hidden="true">
        <circle className="ui-confidence-track" cx="56" cy="56" r="44" />
        <circle
          className="ui-confidence-value"
          cx="56"
          cy="56"
          r="44"
          pathLength="276.46"
          style={{ '--gauge-offset': offset }}
        />
      </svg>
      <figcaption>
        <strong>{pending ? '—' : `${confidence}%`}</strong>
        <span>{pending ? 'Processing' : 'Model confidence'}</span>
      </figcaption>
      <p>{label}</p>
    </figure>
  );
}
