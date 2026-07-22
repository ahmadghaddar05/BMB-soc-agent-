import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiStream, setCsrfToken } from './api';

afterEach(() => {
  setCsrfToken(null);
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('sends CSRF token on unsafe requests', async () => {
    setCsrfToken('csrf-value');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok:true }), {
      status:200, headers:{ 'Content-Type':'application/json' },
    }));
    await api('/settings', { method:'PUT', body:'{}' });
    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe('csrf-value');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('same-origin');
  });

  it('reads standardized error messages and emits a visible error event', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error:{ message:'Broken request', request_id:'req-1' },
    }), { status:400, headers:{ 'Content-Type':'application/json' } }));
    const listener = vi.fn();
    window.addEventListener('bmb-api-error', listener, { once:true });
    await expect(api('/alerts')).rejects.toThrow('Broken request');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.requestId).toBe('req-1');
  });
});

describe('streaming API client', () => {
  it('parses progress events and returns the final grounded result', async () => {
    const events = [];
    setCsrfToken('csrf-test');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      expect(url).toBe('/api/chat/stream');
      expect(options.headers['X-CSRF-Token']).toBe('csrf-test');
      return new Response([
        JSON.stringify({ type:'progress', stage:'tool_running', tool:'search_alerts' }),
        JSON.stringify({ type:'result', result:{ answer:'Found alert A' } }),
        '',
      ].join('\n'), { status:200, headers:{ 'Content-Type':'application/x-ndjson' } });
    });
    const result = await apiStream('/chat/stream', {
      method:'POST', body:JSON.stringify({ message:'Find A' }),
    }, event => events.push(event));
    expect(result.answer).toBe('Found alert A');
    expect(events[0]).toMatchObject({ stage:'tool_running', tool:'search_alerts' });
  });

  it('turns a streamed Hermes error into a rejected request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`${JSON.stringify({
      type:'error', status:502, error:{ code:'HERMES_INVALID_OUTPUT', message:'Invalid output' },
    })}\n`, { status:200, headers:{ 'Content-Type':'application/x-ndjson' } }));
    await expect(apiStream('/chat/stream', { method:'POST' })).rejects.toMatchObject({
      code:'HERMES_INVALID_OUTPUT', status:502,
    });
  });
});
