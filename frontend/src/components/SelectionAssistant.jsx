import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

const MIN_SELECTION_LENGTH = 3;
const MAX_SELECTION_LENGTH = 800;

function isEditable(node) {
  const element = node?.nodeType === window.Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest('input, textarea, [contenteditable="true"], .soc-chat-panel'));
}

export default function SelectionAssistant() {
  const [selection, setSelection] = useState(null);

  useEffect(() => {
    function inspectSelection(event) {
      if (event?.target?.closest?.('.selection-assistant')) return;
      window.setTimeout(() => {
        const selected = window.getSelection();
        const text = selected?.toString().replace(/\s+/g, ' ').trim() || '';
        if (!selected || selected.rangeCount === 0 || text.length < MIN_SELECTION_LENGTH || isEditable(selected.anchorNode)) {
          setSelection(null);
          return;
        }
        const rect = selected.getRangeAt(0).getBoundingClientRect();
        if (!rect.width && !rect.height) return setSelection(null);
        setSelection({
          text: text.slice(0, MAX_SELECTION_LENGTH),
          left: Math.min(Math.max(rect.left + rect.width / 2, 76), window.innerWidth - 76),
          top: Math.max(rect.top - 48, 12),
        });
      }, 0);
    }

    function dismiss(event) {
      if (!event.target.closest?.('.selection-assistant')) setSelection(null);
    }

    const dismissOnScroll = () => setSelection(null);
    document.addEventListener('mouseup', inspectSelection);
    document.addEventListener('keyup', inspectSelection);
    document.addEventListener('mousedown', dismiss);
    window.addEventListener('scroll', dismissOnScroll, true);
    return () => {
      document.removeEventListener('mouseup', inspectSelection);
      document.removeEventListener('keyup', inspectSelection);
      document.removeEventListener('mousedown', dismiss);
      window.removeEventListener('scroll', dismissOnScroll, true);
    };
  }, []);

  if (!selection) return null;

  function askAgent() {
    window.dispatchEvent(new CustomEvent('open-soc-assistant', {
      detail: {
        prompt: `Explain this selected SOC text in plain language. Use connected evidence when relevant, and clearly state any limitations:\n\n${selection.text}`,
        autoSend: true,
      },
    }));
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  return (
    <button
      type="button"
      className="selection-assistant"
      style={{ left: selection.left, top: selection.top }}
      onMouseDown={event => event.preventDefault()}
      onClick={askAgent}
      title="Ask the AI analyst about selected text"
    >
      <Sparkles /> Ask AI
    </button>
  );
}
