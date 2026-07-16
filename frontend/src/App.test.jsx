import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import App from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type':'application/json', 'X-Request-ID':'test-request' },
});

async function settle(milliseconds = 80) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, milliseconds)); });
}

describe('authenticated application flows', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  async function renderAt(path) {
    window.history.replaceState({}, '', path);
    root = createRoot(container);
    await act(async () => root.render(<App />));
    await settle();
  }

  it('routes to alert search and loads the selected alert detail', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'mock' });
      if (url.includes('/alert-groups?')) return jsonResponse({ total:1, groups:[{
        representative_alert_id:'alert-1', group_key:'group-1', rule_desc:'Suspicious login',
        source_severity:'high', last_seen:'2026-07-15T10:00:00Z', occurrence_count:1,
      }] });
      if (url.endsWith('/alerts/alert-1')) return jsonResponse({
        id:'alert-1', rule_desc:'Suspicious login', source_severity:'high',
        timestamp:'2026-07-15T10:00:00Z', triage_status:'pending',
      });
      return jsonResponse({});
    });

    await renderAt('/alerts?search=needle');

    expect(document.body.textContent).toContain('Alert Triage Workspace');
    expect(document.body.textContent).toContain('Suspicious login');
    expect(calls.some(url => url.includes('/alert-groups?') && url.includes('search=needle'))).toBe(true);
    expect(calls.some(url => url.endsWith('/alerts/alert-1'))).toBe(true);
  });

  it('loads dashboard activity within the alerts API page-size contract', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const calls = [];
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/stats')) return jsonResponse({ alerts:{ total:1, grouped_activities:1 }, incidents:{ total:0, open:0 }, recent_runs:[], severity_split:[], top_src_ips:[] });
      if (url.endsWith('/collector/status')) return jsonResponse({ collector:{ scheduler_enabled:false, scheduler_running:false }, latest_run:null });
      if (url.includes('/alert-groups?')) return jsonResponse({ total:0, groups:[] });
      if (url.includes('/alerts?')) return jsonResponse({ total:1, alerts:[{ id:'elastic:1', timestamp:new Date().toISOString(), rule_level:12 }] });
      return jsonResponse({});
    });

    await renderAt('/dashboard');

    expect(calls.some(url => url.includes('/alerts?page=1&limit=200&from='))).toBe(true);
    expect(calls.some(url => url.includes('limit=1000'))).toBe(false);
  });

  it('updates incident status through the protected API workflow', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'mock' });
      if (url.includes('/incidents?status=')) return jsonResponse({ total:1, incidents:[{ id:7, title:'Credential attack', severity:'high', status:'open', alert_ids:[] }] });
      if (url.endsWith('/incidents/7') && (options.method || 'GET') === 'PATCH') return jsonResponse({ id:7, status:'closed' });
      if (url.endsWith('/incidents/7')) return jsonResponse({ id:7, title:'Credential attack', severity:'high', status:'open', alert_ids:[], alerts:[] });
      return jsonResponse({});
    });

    await renderAt('/incidents');
    const closeButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Close incident record'));
    expect(closeButton).toBeTruthy();
    await act(async () => closeButton.click());
    await settle();

    const patch = requests.find(item => item.url.endsWith('/incidents/7') && item.options.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch.options.body)).toEqual({ status:'closed' });
    expect(patch.options.headers['X-CSRF-Token']).toBe('csrf-token');
  });

  it('exposes the bounded Hermes correlation policy and saves it independently', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/settings') && (options.method || 'GET') === 'PUT') {
        return jsonResponse({ ok:true, settings:JSON.parse(options.body) });
      }
      if (url.endsWith('/settings')) return jsonResponse({
        settings:{
          correlation_enabled:'false', correlation_lookback_hours:'24',
          correlation_entity_window_hours:'6', correlation_max_alerts:'40',
          correlation_token_budget:'20000', triage_enabled:'false', caching_enabled:'true',
        },
        stats:{ total:0, enriched:0, enrichment_failed:0, enrich_pending:0, triaged:0, triage_failed:0, auto_closed:0 },
      });
      if (url.endsWith('/scheduler/status')) return jsonResponse({ running:false, recent_runs:[] });
      return jsonResponse({});
    });

    await renderAt('/settings');
    const heading = [...document.querySelectorAll('h3')].find(node => node.textContent.includes('Hermes correlation'));
    expect(heading).toBeTruthy();
    const section = heading.parentElement;
    const toggle = section.querySelector('button');
    await act(async () => toggle.click());
    const save = [...section.querySelectorAll('button')].find(button => button.textContent.includes('Save correlation policy'));
    await act(async () => save.click());
    await settle();

    const put = requests.find(item => item.url.endsWith('/settings') && item.options.method === 'PUT');
    expect(JSON.parse(put.options.body)).toMatchObject({
      correlation_enabled:'true', correlation_lookback_hours:'24',
      correlation_entity_window_hours:'6', correlation_max_alerts:'40',
      correlation_token_budget:'20000',
    });
  });

  it('surfaces API failure states to the analyst', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'degraded', source:'mock' });
      if (url.includes('/alert-groups?')) return jsonResponse({ error:{ code:'COLLECTOR_DOWN', message:'Collector unavailable', request_id:'failure-1' } }, 503);
      return jsonResponse({});
    });

    await renderAt('/alerts');

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Collector unavailable');
    expect(document.body.textContent).toContain('No alerts match these filters');
  });
});
