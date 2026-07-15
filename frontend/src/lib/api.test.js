import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setCsrfToken } from './api';

afterEach(() => {
  vi.restoreAllMocks();
  setCsrfToken(null);
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error:{ message:'Broken request', request_id:'req-1' } }), {
      status:400, headers:{ 'Content-Type':'application/json' },
    }));
    const listener = vi.fn();
    window.addEventListener('bmb-api-error', listener, { once:true });
    await expect(api('/alerts')).rejects.toThrow('Broken request');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.requestId).toBe('req-1');
  });
});
