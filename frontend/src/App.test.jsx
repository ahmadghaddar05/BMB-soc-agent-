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
    await vi.dynamicImportSettled();
    await settle();
  }

  it('uses one login page and redirects from the server-assigned role', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ error:'Authentication required' }, 401);
      if (url.endsWith('/auth/login')) return jsonResponse({
        user:{ id:'1', username:'ciso', display_name:'Executive User', role:'executive' }, csrf:'executive-csrf',
      });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/executive/overview?days=30')) return jsonResponse({
        generated_at:new Date().toISOString(), window_days:30,
        health:{ score:90, status:'healthy', drivers:[] },
        business_risks:{ total:0, by_impact:{ high:0, medium:0, low:0 } },
        automation:{ activities_seen:0, triaged:0, triage_rate:0 },
        time_saved:{ hours:0, period_days:30 }, risk_trend:[], top_assets:[],
      });
      if (url.endsWith('/agent/status')) return jsonResponse({ enabled:false, readiness:{}, recent_operations:[] });
      if (url.endsWith('/collector/status')) return jsonResponse({ collector:{ scheduler_enabled:false, scheduler_running:false } });
      return jsonResponse({});
    });

    await renderAt('/login');
    expect(document.querySelector('.login-bmb-lockup')).not.toBeNull();
    expect(document.body.textContent).not.toContain('One secure entry point');
    expect(document.body.textContent).toContain('role and landing page are determined');
    expect(document.querySelectorAll('.login-portal-card')).toHaveLength(0);

    const [username, password] = document.querySelectorAll('.login-card input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value').set.call(username, 'ciso');
      username.dispatchEvent(new Event('input', { bubbles:true }));
      Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value').set.call(password, 'executive-secret');
      password.dispatchEvent(new Event('input', { bubbles:true }));
    });
    await act(async () => document.querySelector('.login-card').dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })));
    await vi.dynamicImportSettled();
    await settle();

    const login = requests.find(item => item.url.endsWith('/auth/login'));
    expect(JSON.parse(login.options.body)).toEqual({ username:'ciso', password:'executive-secret' });
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('opens an account menu before signing out', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      calls.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'admin', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/auth/logout')) return jsonResponse({ ok:true });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      return jsonResponse({});
    });

    await renderAt('/integrations');
    const profile = document.querySelector('[aria-label="Open account menu for admin"]');
    expect(profile).toBeTruthy();
    await act(async () => profile.click());

    expect(calls.some(item => item.url.endsWith('/auth/logout'))).toBe(false);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Signed in as');
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Security Administrator');

    const signOut = document.querySelector('[role="menuitem"]');
    await act(async () => signOut.click());
    await settle();
    expect(calls.some(item => item.url.endsWith('/auth/logout'))).toBe(true);
    expect(document.querySelector('.login-bmb-lockup')).not.toBeNull();
  });

  it('uses the authenticated role for navigation and redirects unauthorized executive routes', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'ciso', role:'executive' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/executive/overview?days=30')) return jsonResponse({
        generated_at:new Date().toISOString(), window_days:30,
        health:{ score:90, status:'healthy', drivers:[] },
        business_risks:{ total:0, by_impact:{ high:0, medium:0, low:0 } },
        automation:{ activities_seen:0, triaged:0, triage_rate:0 },
        time_saved:{ hours:0, period_days:30 }, risk_trend:[], top_assets:[],
      });
      if (url.endsWith('/agent/status')) return jsonResponse({ enabled:false, readiness:{}, recent_operations:[] });
      if (url.endsWith('/collector/status')) return jsonResponse({ collector:{ scheduler_enabled:false, scheduler_running:false } });
      return jsonResponse({});
    });

    await renderAt('/alerts');

    expect(window.location.pathname).toBe('/dashboard');
    expect(document.body.textContent).toContain('Executive Reports');
    expect(document.body.textContent).not.toContain('Technical Triage');
    expect(document.querySelector('.global-search')).toBeNull();
  });

  it('does not expose a client-side role switcher', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'admin', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      return jsonResponse({});
    });

    await renderAt('/integrations');
    const preview = document.querySelector('[aria-label="Preview experience as role"]');
    expect(preview).toBeNull();
    expect(document.body.textContent).toContain('Integrations');
    expect(document.body.textContent).toContain('Security Administrator');
    expect(document.body.textContent).not.toContain('SOC Analyst preview');
  });

  it('lets an administrator create a role-bound user from Users & Access', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({
        user:{ id:'3', username:'admin', display_name:'Security Administrator', role:'administrator' },
        csrf:'csrf-token',
      });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/admin/runtime')) return jsonResponse({
        generated_at:new Date().toISOString(),
        authentication:{
          mode:'database_managed_rbac', current_user:'admin', current_user_id:'3',
          current_role:'administrator', session_ttl_minutes:480,
          directory:{ total:1, active:1, executives:0, analysts:0, administrators:1 },
        },
      });
      if (url.endsWith('/admin/users') && String(options.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(options.body);
        return jsonResponse({ user:{
          id:'4', username:body.username, display_name:body.display_name, role:body.role,
          active:true, created_by:'admin', created_at:new Date().toISOString(), last_login_at:null,
        } }, 201);
      }
      if (url.endsWith('/admin/users')) return jsonResponse({
        total:1,
        users:[{
          id:'3', username:'admin', display_name:'Security Administrator', role:'administrator',
          active:true, created_by:'bootstrap', created_at:new Date().toISOString(), last_login_at:null,
        }],
      });
      return jsonResponse({});
    });

    await renderAt('/users-access');
    expect(document.body.textContent).toContain('Create role-bound account');
    const [displayName, username, password] = document.querySelectorAll('.access-form input');
    const role = document.querySelector('.access-form select');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value').set;
      setter.call(displayName, 'Maya Georges');
      displayName.dispatchEvent(new Event('input', { bubbles:true }));
      setter.call(username, 'maya.georges');
      username.dispatchEvent(new Event('input', { bubbles:true }));
      setter.call(password, 'maya-secure-password');
      password.dispatchEvent(new Event('input', { bubbles:true }));
      role.value = 'soc_analyst';
      role.dispatchEvent(new Event('change', { bubbles:true }));
    });
    await act(async () => document.querySelector('.access-form').dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })));
    await settle();

    const create = requests.find(item =>
      item.url.endsWith('/admin/users') && String(item.options.method).toUpperCase() === 'POST');
    expect(JSON.parse(create.options.body)).toEqual({
      display_name:'Maya Georges',
      username:'maya.georges',
      role:'soc_analyst',
      password:'maya-secure-password',
    });
    expect(document.body.textContent).toContain('Maya Georges was created as SOC Analyst');
  });

  it('lets an administrator select an allowlisted model route without exposing a key field', async () => {
    const requests = [];
    const profiles = [
      {
        id:'gpt_5_6_sol', label:'GPT-5.6 Sol', provider:'Hermes default route',
        model:'hermes-agent', credential:'Existing Hermes/Codex authentication',
        description:'Existing route', active:true,
      },
      {
        id:'llama_3_3_70b', label:'Meta Llama 3.3 70B', provider:'OpenRouter through Hermes',
        model:'meta-llama/llama-3.3-70b-instruct',
        credential:'OPENROUTER_API_KEY in the Hermes host environment',
        description:'OpenRouter route', active:false,
      },
    ];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({
        user:{ id:'3', username:'admin', display_name:'Security Administrator', role:'administrator' },
        csrf:'csrf-token',
      });
      if (url.endsWith('/health/dependencies')) return jsonResponse({
        status:'ok', source:'elastic', services:{ hermes:{ status:'online', safe:true } },
      });
      if (url.endsWith('/admin/runtime')) return jsonResponse({
        ai_provider:{ provider:'Hermes', model:'hermes-agent', route:'Hermes default route', credential_configured:true },
      });
      if (url.endsWith('/settings')) return jsonResponse({ settings:{} });
      if (url.endsWith('/agent/status')) return jsonResponse({ enabled:false, recent_operations:[] });
      if (url.endsWith('/admin/ai-model') && options.method === 'PUT') {
        return jsonResponse({
          gateway:'Hermes', active_profile_id:'llama_3_3_70b',
          profiles:profiles.map(profile => ({ ...profile, active:profile.id === 'llama_3_3_70b' })),
        });
      }
      if (url.endsWith('/admin/ai-models')) {
        return jsonResponse({ gateway:'Hermes', active_profile_id:'gpt_5_6_sol', profiles });
      }
      return jsonResponse({});
    });

    await renderAt('/ai-configuration');
    expect(document.body.textContent).toContain('AI model routing');
    expect(document.body.textContent).toContain('Meta Llama 3.3 70B');
    expect(document.querySelector('input[name*="key"]')).toBeNull();

    const llama = [...document.querySelectorAll('[role="radio"]')]
      .find(button => button.textContent.includes('Meta Llama 3.3 70B'));
    await act(async () => llama.click());
    const activate = [...document.querySelectorAll('button')]
      .find(button => button.textContent.includes('Activate for new runs'));
    await act(async () => activate.click());
    await settle();

    const update = requests.find(item => item.url.endsWith('/admin/ai-model') && item.options.method === 'PUT');
    expect(JSON.parse(update.options.body)).toEqual({ profile_id:'llama_3_3_70b' });
    expect(update.options.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(document.body.textContent).toContain('active for new runs');
  });

  it('routes to alert search and loads the selected alert detail', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
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

  it('loads the auditable executive contract without sampling a page of raw alerts', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const calls = [];
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'ciso', role:'executive' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/executive/overview?days=30')) return jsonResponse({
        generated_at:new Date().toISOString(), window_days:30,
        health:{ score:91, status:'healthy', drivers:[] },
        business_risks:{ total:1, by_impact:{ high:1, medium:0, low:0 } },
        automation:{ activities_seen:10, triaged:9, triage_rate:90, primary_metric:'ai_triage_coverage', end_to_end_completion_supported:false, fully_automated_closed:null, autonomous_completion_rate:null },
        time_saved:{ hours:2.5, period_days:30, methodology:'Transparent workflow estimate.' },
        risk_trend:[], top_assets:[],
      });
      if (url.endsWith('/collector/status')) return jsonResponse({ collector:{ scheduler_enabled:false, scheduler_running:false }, latest_run:null });
      if (url.endsWith('/agent/status')) return jsonResponse({ enabled:true, readiness:{ scheduler:true, triage:true, correlation:true, autonomous:true }, recent_operations:[] });
      return jsonResponse({});
    });

    await renderAt('/dashboard');

    expect(calls.some(url => url.endsWith('/executive/overview?days=30'))).toBe(true);
    expect(calls.some(url => url.includes('/alerts?'))).toBe(false);
    expect(document.body.textContent).toContain('Cyber Risk Exposure');
    expect(document.body.textContent).toContain('AI triage coverage');
    expect(document.body.textContent).toContain('90%');
    expect(document.body.textContent).toContain('External actions executed: 0');
    expect(document.body.textContent).not.toContain('Live Security Feed');
  });

  it('renders dedicated monitoring with specific titles and source severity', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/alerts?page=1&limit=100')) return jsonResponse({ total:1, alerts:[{
        id:'elastic:credential-1',
        rule_desc:'Critical Security Event Detected', event_action:'credential-dumping',
        source_severity:'high', rule_level:12, hostname:'DEV-WS002', event_dataset:'edr.endpoint',
        timestamp:new Date().toISOString(), triage_status:'pending',
      }] });
      if (url.endsWith('/collector/status')) return jsonResponse({ collector:{
        live_collection_enabled:true, live_collection_running:true,
        scheduler_enabled:false, scheduler_running:false,
      } });
      return jsonResponse({});
    });

    await renderAt('/live-monitoring');

    expect(document.body.textContent).toContain('Live Monitoring');
    expect(document.body.textContent).toContain('Credential dumping attempt');
    expect(document.body.textContent).not.toContain('Critical Security Event Detected');
    expect(document.body.textContent).toContain('high');
    expect(document.body.textContent).toContain('Elastic live ingest active');
  });

  it('keeps live alerts visible when collector health is temporarily unavailable', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'degraded', source:'elastic' });
      if (url.endsWith('/alerts?page=1&limit=100')) return jsonResponse({ total:1, alerts:[{
        id:'elastic:live-1', rule_desc:'Credential dumping detected', source_severity:'critical',
        hostname:'FIN-WS001', event_dataset:'edr.endpoint', timestamp:new Date().toISOString(),
      }] });
      if (url.endsWith('/collector/status')) return jsonResponse({ error:'Collector status timed out' }, 503);
      return jsonResponse({});
    });

    await renderAt('/live-monitoring');

    expect(document.body.textContent).toContain('Credential dumping detected');
    expect(document.body.textContent).toContain('Alerts are live; collector health is unavailable');
  });

  it('keeps executives out of the technical incident workspace', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'ciso', role:'executive' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/executive/overview?days=30')) return jsonResponse({
        generated_at:new Date().toISOString(), window_days:30,
        health:{ score:82, status:'guarded', drivers:[] },
        business_risks:{ total:0, by_impact:{ critical:0, high:0, medium:0, low:0 }, items:[] },
        automation:{ activities_seen:0, triaged:0, triage_rate:0 },
        time_saved:{ hours:0, period_days:30 }, risk_trend:[], top_assets:[],
      });
      if (url.endsWith('/collector/status')) return jsonResponse({ collector:{ scheduler_enabled:true, scheduler_running:true } });
      return jsonResponse({});
    });

    await renderAt('/incidents?incident=7');

    expect(window.location.pathname).toBe('/dashboard');
    expect(document.body.textContent).toContain('Risk, resilience, and required decisions');
    expect(requests.some(url => /\/incidents(?:\/|\?)/.test(url))).toBe(false);
  });

  it('explains the recorded AI triage decision without inferring missing workflow stages', async () => {
    const alert = {
      id:'elastic:explain-1',
      representative_alert_id:'elastic:explain-1',
      group_key:'explain-group',
      occurrence_count:1,
      rule_desc:'Suspicious PowerShell execution',
      source_severity:'critical',
      event_dataset:'edr.endpoint',
      hostname:'DEV-WS002',
      username:'maya.georges',
      timestamp:'2026-07-28T08:00:00.000Z',
      triage_status:'triaged',
      verdict:{
        verdict:'needs_investigation',
        confidence:0.84,
        narrative:'PowerShell behavior and identity context require analyst validation.',
        citations:[{ type:'alert', id:'elastic:explain-1' }],
        limitations:['The command line was not supplied.'],
      },
    };
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.includes('/alert-groups?')) return jsonResponse({ total:1, groups:[alert] });
      if (url.endsWith('/alerts/elastic%3Aexplain-1')) return jsonResponse(alert);
      if (url.endsWith('/alerts/elastic%3Aexplain-1/journey')) return jsonResponse({
        entity:{ type:'alert', id:alert.id },
        stages:[
          {
            id:1, stage:'collected', status:'completed', executor_type:'system',
            actor:'collector', reason:'Alert accepted from Elastic.',
            input_summary:{ source:'elastic' }, output_summary:{ stored:true },
            limitations:[], created_at:'2026-07-28T08:00:01.000Z', finished_at:'2026-07-28T08:00:01.000Z',
          },
          {
            id:2, stage:'triaged', status:'completed', executor_type:'ai',
            actor:'scheduler', provider:'hermes', model:'meta-llama/llama-3.3-70b-instruct',
            confidence_kind:'triage', confidence:0.84,
            reason:'PowerShell behavior and identity context require analyst validation.',
            input_summary:{ triage_source:'hermes', cache_used:false },
            output_summary:{ verdict:'needs_investigation', severity:'critical', citation_count:1 },
            limitations:['The command line was not supplied.'],
            created_at:'2026-07-28T08:00:05.000Z', finished_at:'2026-07-28T08:00:07.000Z',
          },
        ],
        provenance:{ append_only:true, observed_events:2 },
      });
      return jsonResponse({});
    });

    await renderAt('/alerts?time_range=all');

    expect(document.body.textContent).toContain('Why this assessment?');
    expect(document.body.textContent).toContain('PowerShell behavior and identity context require analyst validation.');
    expect(document.body.textContent).toContain('meta-llama/llama-3.3-70b-instruct');
    expect(document.body.textContent).toContain('84%');
    expect(document.body.textContent).toContain('This explains the recorded workflow; it does not independently prove the verdict is correct.');

    const workflowTab = [...document.querySelectorAll('.detail-tabs button')].find(button => button.textContent === 'Workflow');
    await act(async () => workflowTab.click());

    expect(document.body.textContent).toContain('How this alert was processed');
    expect(document.body.textContent).toContain('2 append-only events');
    expect(document.body.textContent).toContain('Missing stages are not inferred');
    expect(document.body.textContent).toContain('Not recorded');
  });

  it('uses one URL-backed executive drawer and closes it with Escape', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'ciso', role:'executive' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/executive/overview?days=30')) return jsonResponse({
        generated_at:new Date().toISOString(), window_days:30,
        health:{ score:82, status:'healthy', drivers:[] },
        business_risks:{ total:1, by_impact:{ high:1, medium:0, low:0 } },
        automation:{ activities_seen:1, triaged:1, triage_rate:100 },
        time_saved:{ hours:0.1, period_days:30 }, risk_trend:[], top_assets:[],
      });
      if (url.endsWith('/agent/status')) return jsonResponse({ enabled:true, readiness:{}, recent_operations:[] });
      if (url.endsWith('/collector/status')) return jsonResponse({ collector:{ scheduler_enabled:true, scheduler_running:true } });
      if (url.includes('/executive/risks?page=1&limit=100')) return jsonResponse({ total:1, risks:[{
        id:7, title:'Potential identity compromise', severity:'critical', business_impact:'high',
        status:'open', owner:null, required_decision:'Assign an accountable incident owner',
        last_seen:new Date().toISOString(),
      }] });
      if (url.endsWith('/executive/incidents/7')) return jsonResponse({
        id:7, title:'Potential identity compromise', severity:'critical', business_impact:'high',
        status:'open', owner:null, required_decision:'Assign an accountable incident owner',
        executive_summary:'This incident remains open. Multiple correlated security signals support the record.',
        impact_basis:'Stored incident severity; business-service criticality is not mapped.',
        evidence_assurance:'Multiple correlated security signals support this incident record.',
        containment_status:'not_recorded', technical_evidence_restricted:true,
      });
      return jsonResponse({});
    });

    await renderAt('/dashboard');
    const trigger = document.querySelector('[aria-label="Review supporting evidence for Open Critical Incidents"]');
    expect(trigger).toBeTruthy();
    await act(async () => trigger.click());
    await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Risks requiring attention');
    expect(window.location.search).toContain('detail=risk-summary');
    expect(document.body.textContent).not.toContain('Open Technical Triage Board');

    const risk = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.includes('Potential identity compromise'));
    expect(risk).toBeTruthy();
    await act(async () => risk.click());
    await settle();
    expect(document.body.textContent).toContain('AI-assisted executive interpretation');
    expect(document.body.textContent).toContain('Role-safe view');
    expect(document.body.textContent).not.toContain('Correlation timeline');
    expect(document.body.textContent).not.toContain('Selected evidence');

    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key:'Escape', bubbles:true })));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.search).not.toContain('detail=');
  });

  it('updates incident status through the protected API workflow', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'mock' });
      if (url.includes('/incidents?status=')) return jsonResponse({ total:1, incidents:[{ id:7, title:'Credential attack', severity:'critical', status:'open', alert_ids:[] }] });
      if (url.endsWith('/incidents/7') && (options.method || 'GET') === 'PATCH') return jsonResponse({ id:7, status:'closed' });
      if (url.endsWith('/workflow-reviews') && options.method === 'POST') return jsonResponse({
        review:{
          id:4, entity_type:'incident', entity_id:'7', decision:'confirmed',
          reason:'Stored correlation evidence supports this incident.', actor:'analyst',
          created_at:'2026-07-29T08:00:00Z',
        },
      }, 201);
      if (url.endsWith('/incidents/7/journey')) return jsonResponse({
        entity:{ id:7, alert_ids:['A','B'], confidence:0.88 },
        analyst_reviews:[],
        stages:[{
          id:9, stage:'incident_decision', status:'completed', executor_type:'ai',
          model:'meta-llama/llama-3.3-70b-instruct', confidence:0.88,
          output_summary:{ persistence_status:'created' },
          reason:'The validated alert group created this incident.',
        }],
        correlation:{
          coverage:{ total_alerts:2, correlation_recorded:2, incident_decision_recorded:2 },
          alert_outcomes:[
            { alert_id:'A', stage:'correlated', status:'completed', reason:'Shared identity and host.' },
            { alert_id:'A', stage:'incident_decision', status:'completed' },
            { alert_id:'B', stage:'correlated', status:'completed', reason:'Shared identity and host.' },
            { alert_id:'B', stage:'incident_decision', status:'completed' },
          ],
        },
      });
      if (url.endsWith('/incidents/7')) return jsonResponse({ id:7, title:'Credential attack', severity:'critical', status:'open', alert_ids:[], alerts:[] });
      return jsonResponse({});
    });

    await renderAt('/incidents');
    expect(document.body.textContent).toContain('Select an incident to enter its command workspace');
    expect(document.body.textContent).toContain('Credential attack');
    expect(document.querySelector('.incident-queue-severity')?.textContent).toContain('Critical');
    expect(document.querySelector('.incident-queue-severity')?.textContent).not.toContain('Low');
    expect(document.body.textContent).not.toContain('Close incident record');

    const openButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Open incident'));
    expect(openButton).toBeTruthy();
    await act(async () => openButton.click());
    await settle();

    expect(document.body.textContent).toContain('Why were these alerts grouped?');
    expect(document.body.textContent).toContain('Created this incident');
    expect(document.body.textContent).toContain('2/2 alerts');
    expect(document.body.textContent).toContain('No analyst decision recorded');

    const reviewButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Record review'));
    await act(async () => reviewButton.click());
    const reviewReason = document.querySelector('.analyst-review-reason textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value').set.call(
        reviewReason, 'Stored correlation evidence supports this incident.'
      );
      reviewReason.dispatchEvent(new Event('input', { bubbles:true }));
    });
    const recordButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Record analyst review'));
    await act(async () => recordButton.click());
    await settle();
    expect(document.body.textContent).toContain('Confirm by analyst');
    const reviewRequest = requests.find(item => item.url.endsWith('/workflow-reviews') && item.options.method === 'POST');
    expect(JSON.parse(reviewRequest.options.body)).toMatchObject({
      entity_type:'incident', entity_id:'7', decision:'confirmed',
    });
    expect(reviewRequest.options.headers['X-CSRF-Token']).toBe('csrf-token');

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
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'admin', role:'administrator' }, csrf:'csrf-token' });
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

    await renderAt('/ai-configuration');
    const toggle = document.querySelector('[role="switch"][aria-label="Scheduled correlation"]');
    expect(toggle).toBeTruthy();
    const section = toggle.closest('section');
    await act(async () => toggle.click());
    const save = [...section.querySelectorAll('button')].find(button => button.textContent.includes('Save policy'));
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
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'admin', role:'administrator' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.endsWith('/settings') && options.method === 'PUT') return jsonResponse({ ok:true, settings:JSON.parse(options.body) });
      if (url.endsWith('/settings')) return jsonResponse({
        settings:{
          autonomous_agent_enabled:'false', autonomous_lookback_hours:'24',
          autonomous_min_confidence:'0.70', autonomous_max_items:'20',
          autonomous_assignment_enabled:'true', autonomous_default_owner:'SOC Analyst',
          simulated_response_proposals_enabled:'false',
        }, stats:{},
      });
      if (url.endsWith('/scheduler/status')) return jsonResponse({ running:false, recent_runs:[] });
      return jsonResponse({});
    });

    await renderAt('/ai-configuration');
    const toggle = document.querySelector('[role="switch"][aria-label="Workflow assistance"]');
    expect(toggle).toBeTruthy();
    const section = toggle.closest('section');
    await act(async () => toggle.click());
    const save = [...section.querySelectorAll('button')].find(button => button.textContent.includes('Save policy'));
    await act(async () => save.click());
    await settle();

    const put = requests.find(item => item.url.endsWith('/settings') && item.options.method === 'PUT');
    expect(JSON.parse(put.options.body)).toMatchObject({
      autonomous_agent_enabled:'true', autonomous_lookback_hours:'24',
      autonomous_min_confidence:'0.70', autonomous_max_items:'20',
      autonomous_assignment_enabled:'true', autonomous_default_owner:'SOC Analyst',
      simulated_response_proposals_enabled:'false',
    });
  });

  it('creates a durable investigation through the protected API', async () => {
    const requests = [];
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
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
    const create = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Create investigation (1)'));
    await act(async () => create.click());
    await settle();

    const post = requests.find(item => item.url.endsWith('/investigations') && item.options.method === 'POST');
    expect(JSON.parse(post.options.body)).toMatchObject({ search_query:'maya', alert_ids:['elastic:alert-1'] });
    expect(post.options.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(document.body.textContent).toContain('Server-backed workspaces');
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
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
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
      policy_version:'phase9-v1', parameters:{ owner:'Incident Lead' },
      created_at:new Date().toISOString(), approvals:[],
    };
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.includes('/actions?page=1&limit=100&status=pending')) return jsonResponse({ actions:[pending], total:1 });
      if (url.includes('/actions?page=1&limit=100')) return jsonResponse({ actions:[], total:0 });
      if (url.endsWith(`/actions/${pending.id}/decision`) && options.method === 'POST') {
        return jsonResponse({ action_request:{ ...pending, status:'executed', executed_by:'analyst' }, decision:'approved' });
      }
      return jsonResponse({});
    });

    await renderAt('/approvals');
    expect(document.body.textContent).toContain('Human Review Queue');
    expect(document.body.textContent).toContain('Assign accountable incident ownership');
    const textarea = document.querySelector('.approval-decision textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value').set.call(
        textarea, 'Validated assignment with the incident lead'
      );
      textarea.dispatchEvent(new Event('input', { bubbles:true }));
    });
    const approve = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Approve internal action'));
    await act(async () => approve.click());
    await settle();

    const post = requests.find(entry => entry.url.endsWith(`/actions/${pending.id}/decision`) && entry.options.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(post.options.body)).toEqual({ decision:'approved', reason:'Validated assignment with the incident lead' });
    expect(post.options.headers['X-CSRF-Token']).toBe('csrf-token');
  });

  it('shows verified simulated responses and submits rollback through the approval gate', async () => {
    const requests = [];
    const response = {
      id:'20000000-0000-4000-8000-000000000001', response_type:'endpoint_isolate',
      target_value:'server-1', state:'active', evidence_alert_ids:['elastic:alert-1'],
      executed_by:'lead', executed_at:new Date().toISOString(), verified_at:new Date().toISOString(),
    };
    globalThis.fetch = vi.fn(async (input, options = {}) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'ok', source:'elastic' });
      if (url.includes('/responses?page=1&limit=100')) return jsonResponse({ responses:[response], total:1 });
      if (url.endsWith(`/responses/${response.id}/rollback`) && options.method === 'POST') {
        return jsonResponse({ action_request:{ id:'action-rollback', status:'pending', action_type:'response.rollback' } }, 202);
      }
      if (url.endsWith(`/responses/${response.id}`)) return jsonResponse({
        ...response, verification:{ verified:true, observed_state:'active' },
        events:[{ id:1, event_type:'verified', actor:'lead', created_at:new Date().toISOString() }],
      });
      return jsonResponse({});
    });

    await renderAt('/responses');
    expect(document.body.textContent).toContain('Safe Response Simulation');
    expect(document.body.textContent).toContain('Validate the AI recommendation without affecting production');
    expect(document.body.textContent).toContain('server-1');
    expect(document.body.textContent).toContain('active state confirmed; external side effects remain false.');
    const textarea = document.querySelector('.response-rollback textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Exercise completed safely');
      textarea.dispatchEvent(new Event('input', { bubbles:true }));
    });
    const rollback = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Request rollback approval'));
    await act(async () => rollback.click());
    await settle();

    const post = requests.find(item => item.url.endsWith(`/responses/${response.id}/rollback`) && item.options.method === 'POST');
    expect(JSON.parse(post.options.body)).toEqual({ reason:'Exercise completed safely' });
    expect(post.options.headers['X-CSRF-Token']).toBe('csrf-token');
  });

  it('surfaces API failure states to the analyst', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/auth/session')) return jsonResponse({ user:{ username:'analyst', role:'soc_analyst' }, csrf:'csrf-token' });
      if (url.endsWith('/health/dependencies')) return jsonResponse({ status:'degraded', source:'mock' });
      if (url.includes('/alert-groups?')) return jsonResponse({ error:{ code:'COLLECTOR_DOWN', message:'Collector unavailable', request_id:'failure-1' } }, 503);
      return jsonResponse({});
    });

    await renderAt('/alerts');

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Collector unavailable');
    expect(document.body.textContent).toContain('No alerts match these filters');
  });
});
