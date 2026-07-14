import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export default function InfoTip({ text, align = 'center' }) {
  const anchor = useRef(null);
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, below: false });

  function show() {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const left = align === 'left' ? rect.left : align === 'right' ? rect.right : rect.left + rect.width / 2;
    setPosition({ left, top: rect.top < 90 ? rect.bottom + 10 : rect.top - 10, below: rect.top < 90 });
    setVisible(true);
  }

  useEffect(() => {
    if (!visible) return undefined;
    const hide = () => setVisible(false);
    const escape = event => event.key === 'Escape' && hide();
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); window.removeEventListener('keydown', escape); };
  }, [visible]);

  return (
    <span ref={anchor} className={`info-tip info-tip-${align}`} tabIndex={0} role="button" aria-label={`More information: ${text}`} aria-describedby={visible ? tooltipId : undefined}
      onMouseEnter={show} onMouseLeave={() => setVisible(false)} onFocus={show} onBlur={() => setVisible(false)}
      onClick={event => { event.preventDefault(); event.stopPropagation(); visible ? setVisible(false) : show(); }}>
      <Info aria-hidden="true" />
      {visible && createPortal(<span id={tooltipId} className={`info-tip-portal info-tip-portal-${align} ${position.below ? 'below' : 'above'}`} style={{ left: position.left, top: position.top }} role="tooltip">{text}</span>, document.body)}
    </span>
  );
}
