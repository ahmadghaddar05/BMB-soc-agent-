import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import ChatWidget, { conversationStorageKey } from './ChatWidget';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const response = body => new Response([
  JSON.stringify({ type:'progress', stage:'tool_completed', tool:'search_alerts', evidence_count:1 }),
  JSON.stringify({ type:'result', result:body }),
  '',
].join('\n'), {
  status: 200, headers: { 'Content-Type':'application/x-ndjson' },
});

const errorResponse = (code, message, status = 404) => new Response([
  JSON.stringify({ type:'error', error:{ code, message }, status }),
  '',
].join('\n'), {
  status: 200, headers: { 'Content-Type':'application/x-ndjson' },
});

const ACCOUNT_KEY = 'analyst:soc_analyst';

async function settle(milliseconds = 30) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, milliseconds)); });
}

describe('Hermes chat widget', () => {
  let container;
  let root;

  beforeEach(async () => {
    window.sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ChatWidget role="soc_analyst" accountKey={ACCOUNT_KEY} />));
    await act(async () => container.querySelector('.soc-chat-launcher').click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function typeMessage(text) {
    const textarea = container.querySelector('textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles:true }));
    });
  }

  async function submit(text) {
    await typeMessage(text);
    await act(async () => container.querySelector('[aria-label="Send to Hermes"]').click());
    await settle();
  }

  it('uses server-managed conversation IDs and renders verified evidence citations', async () => {
    const bodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return response({
        answer: 'Investigate alert A.', conversation_id: '11111111-1111-4111-8111-111111111111',
        citations: [{ type:'alert', id:'A' }], confidence: 'high', limitations: ['Test limitation'],
        tools_used: [{ tool:'search_alerts', evidence_count:1 }],
      });
    });

    await submit('First question');
    await submit('Follow-up question');

    expect(bodies[0]).toEqual({ message:'First question' });
    expect(bodies[1]).toEqual({
      message:'Follow-up question', conversation_id:'11111111-1111-4111-8111-111111111111',
    });
    expect(container.textContent).toContain('evidence: alert:A');
    expect(container.textContent).toContain('queried: search_alerts (1)');
    expect(container.textContent).toContain('confidence: high');
    expect(container.textContent).toContain('limitations: Test limitation');
    expect(window.sessionStorage.getItem(conversationStorageKey(ACCOUNT_KEY))).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('lets the analyst cancel an in-flight Hermes run', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new window.DOMException('Aborted', 'AbortError')), { once:true });
    }));

    await typeMessage('Long investigation');
    await act(async () => container.querySelector('[aria-label="Send to Hermes"]').click());
    await settle(5);
    const stopButton = container.querySelector('[aria-label="Stop Hermes request"]');
    expect(stopButton).toBeTruthy();
    await act(async () => stopButton.click());
    await settle();

    expect(container.textContent).toContain('Request cancelled.');
  });

  it('adds page context to the model request while keeping the visible question concise', async () => {
    const bodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return response({
        answer:'The current triage view needs more evidence.',
        conversation_id:'22222222-2222-4222-8222-222222222222',
        citations:[], limitations:['No selected alert was supplied'], tools_used:[],
      });
    });
    await act(async () => root.render(<ChatWidget
      role="soc_analyst"
      accountKey={ACCOUNT_KEY}
      pageContext={{ path:'/alerts?search=maya', title:'Technical Triage', subtitle:'Prioritize activity' }}
    />));

    await submit('What evidence is missing?');

    expect(bodies[0].message).toContain('Experience: soc_analyst');
    expect(bodies[0].message).toContain('Page: Technical Triage');
    expect(bodies[0].message).toContain('Route: /alerts?search=maya');
    expect(bodies[0].message).toContain('User question: What evidence is missing?');
    expect(container.textContent).toContain('What evidence is missing?');
  });

  it('recovers from a conversation owned by another authenticated account', async () => {
    const staleId = '33333333-3333-4333-8333-333333333333';
    const freshId = '44444444-4444-4444-8444-444444444444';
    window.sessionStorage.setItem(conversationStorageKey('executive:executive'), staleId);
    await act(async () => root.render(
      <ChatWidget role="executive" accountKey="executive:executive" />
    ));
    await settle(5);

    const bodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (bodies.length === 1) {
        return errorResponse('CONVERSATION_NOT_FOUND', 'Conversation was not found');
      }
      return response({
        answer:'A new executive conversation is ready.',
        conversation_id:freshId,
        citations:[], limitations:[], tools_used:[],
      });
    });

    await submit('Summarize current risk');

    expect(bodies).toHaveLength(2);
    expect(bodies[0].conversation_id).toBe(staleId);
    expect(bodies[1].conversation_id).toBeUndefined();
    expect(window.sessionStorage.getItem(conversationStorageKey('executive:executive'))).toBe(freshId);
    expect(container.textContent).toContain('A new executive conversation is ready.');
    expect(container.textContent).not.toContain('Error: Conversation was not found');
  });
});
