import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import { MessageSquare, X, Send, Bot, User, Loader2, Square, RotateCcw } from 'lucide-react';

const SUGGESTIONS = [
  'What are the most critical alerts to investigate right now?',
  'Summarize the open incidents.',
  'Any activity from privileged users in the last 24h?',
];

export default function ChatWidget() {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi — I'm your BMB AI analyst. Ask me about alerts, incidents, or what to investigate next." },
  ]);
  const [conversationId, setConversationId] = useState(() => {
    try { return window.sessionStorage.getItem('bmb-soc-conversation-id'); }
    catch { return null; }
  });
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (typeof scrollRef.current?.scrollTo === 'function') {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, open]);

  useEffect(() => {
    const openAssistant = () => setOpen(true);
    window.addEventListener('open-soc-assistant', openAssistant);
    return () => window.removeEventListener('open-soc-assistant', openAssistant);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: q }]);
    setBusy(true);
    const controller = new window.AbortController();
    abortRef.current = controller;
    try {
      const res = await api('/chat', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ message: q, ...(conversationId ? { conversation_id: conversationId } : {}) }),
      });
      setConversationId(res.conversation_id);
      try { window.sessionStorage.setItem('bmb-soc-conversation-id', res.conversation_id); } catch { /* optional */ }
      setMessages(m => [...m, {
        role: 'assistant', content: res.answer, tools: res.tools_used,
        citations: res.citations, confidence: res.confidence, limitations: res.limitations,
      }]);
    } catch (e) {
      const cancelled = e?.name === 'AbortError';
      setMessages(m => [...m, {
        role: 'assistant', content: cancelled ? 'Request cancelled.' : `Error: ${e.message}`, error: true,
      }]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function newConversation() {
    stop();
    setConversationId(null);
    try { window.sessionStorage.removeItem('bmb-soc-conversation-id'); } catch { /* optional */ }
    setMessages([{ role: 'assistant', content: "Hi - I'm your BMB AI analyst. Ask me about alerts, incidents, or what to investigate next." }]);
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="soc-chat-launcher"
          title="Ask the SOC assistant"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="text-xs font-semibold">AI Analyst</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="soc-chat-panel">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600 bg-dark-800">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/20">
                <Bot className="w-4 h-4 text-accent" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">BMB AI Analyst</div>
                <div className="text-xs text-gray-500">Investigation &amp; triage help</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full ${m.role === 'user' ? 'bg-dark-600' : 'bg-accent/20'}`}>
                  {m.role === 'user' ? <User className="w-4 h-4 text-gray-300" /> : <Bot className="w-4 h-4 text-accent" />}
                </div>
                <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-accent/20 text-white'
                  : m.error ? 'bg-red-900/30 text-red-300 border border-red-800'
                  : 'bg-dark-700 text-gray-200'}`}>
                  {m.content}
                  {m.tools?.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-dark-600 text-[10px] text-gray-500">
                      queried: {m.tools.map(t => t.tool).join(', ')}
                    </div>
                  )}
                  {m.citations?.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-dark-600 text-[10px] text-gray-400">
                      evidence: {m.citations.map(citation => `${citation.type}:${citation.id}`).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-accent/20">
                  <Bot className="w-4 h-4 text-accent" />
                </div>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-dark-700 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> investigating…
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="text-xs px-2 py-1 rounded-full bg-dark-700 text-gray-300 border border-dark-600 hover:border-accent hover:text-white">
                  {s.length > 34 ? s.slice(0, 32) + '…' : s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 p-3 border-t border-dark-600">
            <button onClick={newConversation} disabled={busy}
              aria-label="Start a new conversation" title="New conversation"
              className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-dark-700 text-gray-400 hover:text-white disabled:opacity-40">
              <RotateCcw className="w-4 h-4" />
            </button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Ask about alerts, incidents, what to investigate…"
              className="flex-1 resize-none rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent max-h-28"
            />
            {busy ? (
              <button onClick={stop} aria-label="Stop Hermes request" title="Stop"
                className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-red-700 text-white">
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim()} aria-label="Send to Hermes"
                className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-white disabled:opacity-40">
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

