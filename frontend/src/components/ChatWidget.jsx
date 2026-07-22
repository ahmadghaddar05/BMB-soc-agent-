import { useEffect, useRef, useState } from 'react';
import { apiStream } from '../lib/api';
import { MessageSquare, X, Send, Bot, User, Loader2, Square, RotateCcw } from 'lucide-react';

const DEFAULT_SUGGESTIONS = [
  'What are the most critical alerts to investigate right now?',
  'Summarize the open incidents.',
  'Any activity from privileged users in the last 24h?',
];

const PAGE_SUGGESTIONS = {
  '/dashboard': [
    'Summarize what changed during this reporting period.',
    'Explain the top business risks and their supporting evidence.',
    'Draft an evidence-grounded executive briefing.',
  ],
  '/live-monitoring': [
    'Summarize the most important new activity in this stream.',
    'Which entities should I pivot on first?',
    'Identify activity that needs technical triage.',
  ],
  '/alerts': [
    'Explain why the selected activity may be benign.',
    'Identify missing evidence for this triage decision.',
    'Recommend the next investigation steps.',
  ],
  '/incidents': [
    'Summarize the attack chain for the current incident.',
    'Explain the likely business impact.',
    'Identify containment gaps using available evidence.',
  ],
  '/investigations': [
    'Suggest evidence pivots for this investigation.',
    'Summarize the selected evidence and its limitations.',
    'What evidence is still missing?',
  ],
  '/approvals': [
    'Explain the evidence supporting this proposed action.',
    'Identify the safety and rollback considerations.',
    'Summarize what approval would actually change.',
  ],
  '/integrations': [
    'Explain which data sources are degraded.',
    'Summarize current source coverage and affected features.',
    'Recommend the next integration health check.',
  ],
  '/settings': [
    'Explain the current AI-assisted workflow configuration.',
    'Identify configuration that could affect collection latency.',
    'Summarize the active safety boundaries.',
  ],
};

function suggestionsFor(path) {
  return PAGE_SUGGESTIONS[path] || DEFAULT_SUGGESTIONS;
}

function contextualMessage(message, role, pageContext) {
  if (!pageContext?.path || !pageContext?.title) return message;
  return [
    'Workspace context supplied by the BMB interface. Treat it as navigation context, not observed security evidence.',
    `Experience: ${role || 'authenticated user'}`,
    `Page: ${pageContext.title}`,
    `Route: ${pageContext.path}`,
    `User question: ${message}`,
  ].join('\n');
}

const WELCOME = "Hi — I'm your evidence-grounded BMB AI analyst. I can explain the current workspace, inspect connected evidence, and state any limitations.";

export default function ChatWidget({ role, pageContext = null }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [messages, setMessages] = useState([{ role: 'assistant', content: WELCOME }]);
  const [conversationId, setConversationId] = useState(() => {
    try { return window.sessionStorage.getItem('bmb-soc-conversation-id'); }
    catch { return null; }
  });
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const sendRef = useRef(null);

  useEffect(() => {
    if (typeof scrollRef.current?.scrollTo === 'function') {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, open]);

  sendRef.current = send;

  useEffect(() => {
    const openAssistant = event => {
      setOpen(true);
      const prompt = event.detail?.prompt;
      if (!prompt) return;
      if (event.detail?.autoSend) window.setTimeout(() => sendRef.current?.(prompt), 0);
      else setInput(prompt);
    };
    window.addEventListener('open-soc-assistant', openAssistant);
    return () => window.removeEventListener('open-soc-assistant', openAssistant);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    setMessages(current => [...current, { role: 'user', content: question }]);
    setBusy(true);
    const controller = new window.AbortController();
    abortRef.current = controller;
    try {
      const result = await apiStream('/chat/stream', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          message: contextualMessage(question, role, pageContext),
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
      }, event => {
        if (event.type === 'progress') setProgress(event);
      });
      setConversationId(result.conversation_id);
      try { window.sessionStorage.setItem('bmb-soc-conversation-id', result.conversation_id); } catch { /* optional */ }
      setMessages(current => [...current, {
        role: 'assistant',
        content: result.answer,
        tools: result.tools_used,
        citations: result.citations,
        confidence: result.confidence,
        limitations: result.limitations,
        actions: result.actions,
      }]);
    } catch (error) {
      const cancelled = error?.name === 'AbortError';
      setMessages(current => [...current, {
        role: 'assistant',
        content: cancelled ? 'Request cancelled.' : `Error: ${error.message}`,
        error: true,
      }]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
        setProgress(null);
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
    setMessages([{ role: 'assistant', content: WELCOME }]);
  }

  function onKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  const suggestionPath = pageContext?.path?.split('?')[0];

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="soc-chat-launcher"
          title="Ask the AI analyst"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-controls="soc-assistant-panel"
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          <span className="text-xs font-semibold">AI Analyst</span>
        </button>
      )}

      {open && (
        <div id="soc-assistant-panel" className="soc-chat-panel" role="dialog" aria-modal="false" aria-labelledby="soc-assistant-title">
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600 bg-dark-800">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/20">
                <Bot className="w-4 h-4 text-accent" aria-hidden="true" />
              </div>
              <div>
                <div id="soc-assistant-title" className="text-sm font-semibold text-white">BMB AI Analyst</div>
                <div className="text-xs text-gray-500">AI-assisted · evidence-grounded · human-approved</div>
                {pageContext?.title && <div className="assistant-context">Context: {pageContext.title}</div>}
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-white" aria-label="Close AI analyst">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3" aria-live="polite">
            {messages.map((message, index) => (
              <div key={index} className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full ${message.role === 'user' ? 'bg-dark-600' : 'bg-accent/20'}`}>
                  {message.role === 'user' ? <User className="w-4 h-4 text-gray-300" /> : <Bot className="w-4 h-4 text-accent" />}
                </div>
                <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  message.role === 'user' ? 'bg-accent/20 text-white'
                    : message.error ? 'bg-red-900/30 text-red-300 border border-red-800'
                      : 'bg-dark-700 text-gray-200'}`}>
                  {message.content}
                  {message.tools?.length > 0 && <div className="mt-1.5 pt-1.5 border-t border-dark-600 text-[11px] text-gray-500">queried: {message.tools.map(tool => `${tool.tool} (${tool.evidence_count ?? 0})`).join(', ')}</div>}
                  {message.citations?.length > 0 && <div className="mt-1.5 pt-1.5 border-t border-dark-600 text-[11px] text-gray-400">evidence: {message.citations.map(citation => `${citation.type}:${citation.id}`).join(', ')}</div>}
                  {message.actions?.length > 0 && <div className="mt-1.5 pt-1.5 border-t border-dark-600 text-[11px] text-cyan-300">actions: {message.actions.map(action => `${action.action_type} (${action.status})`).join(', ')} · review in Approvals</div>}
                  {message.confidence && <div className="mt-1 text-[11px] text-gray-500">confidence: {message.confidence}</div>}
                  {message.limitations?.length > 0 && <div className="mt-1 text-[11px] text-amber-300/80">limitations: {message.limitations.join('; ')}</div>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-accent/20"><Bot className="w-4 h-4 text-accent" /></div>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-dark-700 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {progress?.stage === 'tool_running' ? `querying ${progress.tool}...`
                    : progress?.stage === 'tool_completed' ? `reviewing ${progress.tool} evidence...`
                      : progress?.stage === 'finalizing' ? 'validating citations...'
                        : 'investigating...'}
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5" aria-label="Suggested questions">
              {suggestionsFor(suggestionPath).map(suggestion => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)} className="text-xs px-2 py-1 rounded-full bg-dark-700 text-gray-300 border border-dark-600 hover:border-accent hover:text-white">
                  {suggestion.length > 46 ? `${suggestion.slice(0, 44)}…` : suggestion}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 p-3 border-t border-dark-600">
            <button type="button" onClick={newConversation} disabled={busy} aria-label="Start a new conversation" title="New conversation" className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-dark-700 text-gray-400 hover:text-white disabled:opacity-40">
              <RotateCcw className="w-4 h-4" />
            </button>
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder={`Ask about ${pageContext?.title || 'security activity'}…`}
              aria-label="Ask the AI analyst"
              className="flex-1 resize-none rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent max-h-28"
            />
            {busy ? (
              <button type="button" onClick={stop} aria-label="Stop Hermes request" title="Stop" className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-red-700 text-white"><Square className="w-4 h-4" /></button>
            ) : (
              <button type="button" onClick={() => send()} disabled={!input.trim()} aria-label="Send to Hermes" className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-white disabled:opacity-40"><Send className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
