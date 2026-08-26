import { useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card';
import { cx } from './utils';

function useCountUp(value) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const [display, setDisplay] = useState(numeric ? 0 : value);
  const animated = useRef(false);

  useEffect(() => {
    if (!numeric || animated.current) {
      setDisplay(value);
      return undefined;
    }
    animated.current = true;
    const started = globalThis.performance.now();
    let frame;
    const update = now => {
      const progress = Math.min(1, (now - started) / 300);
      const eased = 1 - ((1 - progress) ** 3);
      setDisplay(value * eased);
      if (progress < 1) frame = globalThis.requestAnimationFrame(update);
    };
    frame = globalThis.requestAnimationFrame(update);
    return () => globalThis.cancelAnimationFrame(frame);
  }, [numeric, value]);

  return display;
}

function Sparkline({ values = [] }) {
  const points = useMemo(() => {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values.map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 22 - (((value - min) / range) * 18);
      return `${x},${y}`;
    }).join(' ');
  }, [values]);
  if (!points) return null;
  return <svg className="ui-kpi-sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

export default function KpiTile({ label, value, formatter, sparkline, className }) {
  const display = useCountUp(value);
  const formatted = formatter
    ? formatter(display)
    : typeof display === 'number' ? Math.round(display).toLocaleString() : display;
  return (
    <Card compact className={cx('ui-kpi-tile', className)}>
      <span className="ui-kpi-label">{label}</span>
      <strong className="ui-kpi-value" aria-live="polite">{formatted}</strong>
      <Sparkline values={sparkline} />
    </Card>
  );
}
