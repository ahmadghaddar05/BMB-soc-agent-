import { Info } from 'lucide-react';

export default function InfoTip({ text, align = 'center' }) {
  return (
    <span className={`info-tip info-tip-${align}`} tabIndex={0} aria-label={text}>
      <Info aria-hidden="true" />
      <span className="info-tip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

