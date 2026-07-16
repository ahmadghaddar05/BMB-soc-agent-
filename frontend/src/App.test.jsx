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

  it('exposes the opt-in autonomous SOC policy and saves its safety controls', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/settings') && options.method === 'PUT') return jsonResponse({ ok:true, settings:JSON.parse(options.body) });
      if (url.endsWith('/settings')) return jsonResponse({
        settings:{
          autonomous_agent_enabled:'false', autonomous_lookback_hours:'24',
          autonomous_min_confidence:'0.70', autonomous_max_items:'20',
          autonomous_assignment_enabled:'true', autonomous_default_owner:'SOC Analyst',
        }, stats:{},
      });
      if (url.endsWith('/scheduler/status')) return jsonResponse({ running:false, recent_runs:[] });
      return jsonResponse({});
    });

    await renderAt('/settings');
    const heading = [...document.querySelectorAll('h3')].find(node => node.textContent.includes('Autonomous SOC agent'));
    expect(heading).toBeTruthy();
    const section = heading.parentElement;
    await act(async () => section.querySelector('button').click());
    const save = [...section.querySelectorAll('button')].find(button => button.textContent.includes('Save autonomous policy'));
    await act(async () => save.click());
    await settle();

    const put = requests.find(item => item.url.endsWith('/settings') && item.options.method === 'PUT');
    expect(JSON.parse(put.options.body)).toMatchObject({
      autonomous_agent_enabled:'true', autonomous_lookback_hours:'24',
      autonomous_min_confidence:'0.70', autonomous_max_items:'20',
      autonomous_assignment_enabled:'true', autonomous_default_owner:'SOC Analyst',
    });
  });

  it('creates a durable investigation through the protected API', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/investigations?limit=100')) return jsonResponse({ investigations:[], total:0 });
      if (url.includes('/alerts?limit=50&search=maya')) return jsonResponse({ alerts:[{
        id:'elastic:alert-1', rule_desc:'Suspicious account activity', username:'maya',
        source_severity:'high', timestamp:new Date().toISOString(),
      }] });
      if (url.endsWith('/investigations') && options.method === 'POST') return jsonResponse({
        id:'4f5f15c5-bf70-47d4-916b-a6fb870c208a', title:'Investigation: maya',
        search_query:'maya', status:'open', owner:'analyst', created_by:'analyst',
        created_at:new Date().toISOString(), alert_ids:['elastic:alert-1'], notes:[], note_count:0,
      }, 201);
      return jsonResponse({});
    });

    await renderAt('/investigations?search=maya');
    const evidenceToggle = document.querySelector('.row-check');
    expect(evidenceToggle).toBeTruthy();
    await act(async () => evidenceToggle.click());
    const create = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Create from 1 alert'));
    await act(async () => create.click());
    await settle();

    const post = requests.find(item => item.url.endsWith('/investigations') && item.options.method === 'POST');
    expect(JSON.parse(post.options.body)).toMatchObject({ search_query:'maya', alert_ids:['elastic:alert-1'] });
    expect(post.options.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(document.body.textContent).toContain('Stored securely on the SOC server');
  });

  it('persists case ownership through the protected case API', async () => {
    const requests = [];
    const item = {
      id:7, title:'Credential attack', severity:'high', status:'open', owner:null,
      alert_ids:['alert-1'], first_seen:new Date().toISOString(), notes:[], note_count:0,
    };
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/cases?limit=100')) return jsonResponse({ cases:[item], total:1 });
      if (url.endsWith('/cases/7') && options.method === 'PATCH') return jsonResponse({ ...item, owner:'SOC Analyst' });
      if (url.endsWith('/cases/7')) return jsonResponse(item);
      return jsonResponse({});
    });

    await renderAt('/cases');
    const owner = document.querySelector('.case-form select');
    expect(owner).toBeTruthy();
    await act(async () => {
      owner.value = 'SOC Analyst';
      owner.dispatchEvent(new Event('change', { bubbles:true }));
    });
    await settle();

    const patch = requests.find(entry => entry.url.endsWith('/cases/7') && entry.options.method === 'PATCH');
    expect(JSON.parse(patch.options.body)).toEqual({ owner:'SOC Analyst' });
    expect(patch.options.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(document.body.textContent).toContain('Durable ownership');
  });

  it('reviews and approves a sensitive Hermes action through the protected approval queue', async () => {
    const requests = [];
    const pending = {
      id:'10000000-0000-4000-8000-000000000007', action_type:'case.update',
      target_type:'case', target_id:'7', status:'pending', approval_required:true,
      requested_by:'analyst', reason:'Assign accountable incident ownership',
      policy_version:'phase7-v1', parameters:{ owner:'Incident Lead' },
      created_at:new Date().toISOString(), approvals:[],
    };
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.includes('/actions?page=1&limit=100&status=pending')) return jsonResponse({ actions:[pending], total:1 });
      if (url.includes('/actions?page=1&limit=100')) return jsonResponse({ actions:[], total:0 });
      if (url.endsWith(`/actions/${pending.id}/decision`) && options.method === 'POST') {
        return jsonResponse({ action_request:{ ...pending, status:'executed', executed_by:'analyst' }, decision:'approved' });
      }
      return jsonResponse({});
    });

    await renderAt('/approvals');
    expect(document.body.textContent).toContain('Phase 7 safety boundary');
    expect(document.body.textContent).toContain('Assign accountable incident ownership');
    const textarea = document.querySelector('.approval-decision textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value').set.call(
        textarea, 'Validated assignment with the incident lead'
      );
      textarea.dispatchEvent(new Event('input', { bubbles:true }));
    });
    const approve = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Approve and execute'));
    await act(async () => approve.click());
    await settle();

    const post = requests.find(entry => entry.url.endsWith(`/actions/${pending.id}/decision`) && entry.options.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(post.options.body)).toEqual({ decision:'approved', reason:'Validated assignment with the incident lead' });
    expect(post.options.headers['X-CSRF-Token']).toBe('csrf-token');
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
