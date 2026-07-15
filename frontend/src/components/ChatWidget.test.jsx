import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import ChatWidget from './ChatWidget';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const response = body => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type':'application/json' },
});

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
    await act(async () => root.render(<ChatWidget />));
    await act(async () => container.querySelector('.soc-chat-launcher').click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function submit(text) {
    const textarea = container.querySelector('textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles:true }));
    });
    await act(async () => container.querySelector('[aria-label="Send to Hermes"]').click());
    await settle();
  }

  it('uses server-managed conversation IDs and renders verified evidence citations', async () => {
    const bodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return response({
        answer: 'Investigate alert A.', conversation_id: '11111111-1111-4111-8111-111111111111',
        citations: [{ type:'alert', id:'A' }], confidence: 'high', tools_used: [{ tool:'soc_evidence_snapshot' }],
      });
    });

    await submit('First question');
    await submit('Follow-up question');

    expect(bodies[0]).toEqual({ message:'First question' });
    expect(bodies[1]).toEqual({
      message:'Follow-up question', conversation_id:'11111111-1111-4111-8111-111111111111',
    });
    expect(container.textContent).toContain('evidence: alert:A');
    expect(window.sessionStorage.getItem('bmb-soc-conversation-id')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('lets the analyst cancel an in-flight Hermes run', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new window.DOMException('Aborted', 'AbortError')), { once:true });
    }));

    const sending = submit('Long investigation');
    await settle(5);
    const stopButton = container.querySelector('[aria-label="Stop Hermes request"]');
    expect(stopButton).toBeTruthy();
    await act(async () => stopButton.click());
    await sending;

    expect(container.textContent).toContain('Request cancelled.');
  });
});
