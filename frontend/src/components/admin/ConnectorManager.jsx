import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Database, Pencil, PlugZap, Power,
  RefreshCw, Server, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { api, fmtTs } from '../../lib/api';
import StatusBadge from '../StatusBadge';

const PLATFORMS = {
  elastic:{ label:'Elastic Security', description:'Elastic Security detection alerts and raw event evidence.', port:9200 },
  splunk:{ label:'Splunk Enterprise', description:'Search security detections through Splunk management REST.', port:8089 },
  wazuh:{ label:'Wazuh Indexer', description:'Wazuh alerts retrieved from its OpenSearch-compatible indexer.', port:9200 },
};

function initialForm(type = 'elastic') {
  const platform = PLATFORMS[type];
  return {
    connector_type:type, name:'', protocol:'https', host:'', port:platform.port,
    verify_tls:true, ca_certificate:'', api_key:'', token:'', password:'',
    alert_alias:'.alerts-security.alerts-default', event_indices:'logs-*',
    index:type === 'splunk' ? 'main' : 'wazuh-alerts-*',
    search:type === 'splunk' ? 'search index=main' : '', auth_scheme:'Bearer', username:'admin',
  };
}

function connectorTone(connector) {
  if (connector.active && connector.last_test_status === 'success') return 'success';
  if (connector.last_test_status === 'failure') return 'critical';
  if (!connector.enabled) return 'neutral';
  return 'attention';
}

function ConnectorWizard({ connector, onClose, onSaved }) {
  const editing = Boolean(connector);
  const [step, setStep] = useState(editing ? 2 : 1);
  const [form, setForm] = useState(() => connector ? {
    ...initialForm(connector.connector_type),
    ...connector,
    port:Number(connector.port),
    ca_certificate:'', api_key:'', token:'', password:'',
  } : initialForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(current => ({ ...current, [key]:value }));
  const choose = type => {
    setForm(current => ({ ...initialForm(type), name:current.name }));
    setStep(2);
  };
  const credentialProvided = form.connector_type === 'elastic' ? form.api_key
    : form.connector_type === 'splunk' ? form.token : form.password;
  const canContinue = form.name.trim() && form.host.trim() && form.port
    && (editing || credentialProvided);

  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const method = editing ? 'PATCH' : 'POST';
      const path = editing ? `/admin/connectors/${connector.id}` : '/admin/connectors';
      const payload = { ...form };
      if (editing) {
        for (const key of ['api_key','token','password','ca_certificate']) {
          if (!payload[key]) delete payload[key];
        }
      }
      const result = await api(path, { method, body:JSON.stringify(payload) });
      const saved = result.connector;
      try {
        await api(`/admin/connectors/${saved.id}/test`, { method:'POST', body:'{}' });
        onSaved(`${saved.name} was saved and its connection test passed.`);
      } catch (testError) {
        onSaved(`${saved.name} was saved but could not be activated: ${testError.message}`, true);
      }
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally { setSaving(false); }
  };

  return <div className="connector-modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="connector-modal" role="dialog" aria-modal="true" aria-labelledby="connector-wizard-title">
      <header className="connector-modal-head">
        <div><small>Connector setup · Step {step} of 3</small><h3 id="connector-wizard-title">{editing ? `Edit ${connector.name}` : 'Add security source'}</h3></div>
        <button type="button" className="icon-action" onClick={onClose} aria-label="Close connector wizard"><X /></button>
      </header>
      <div className="connector-stepper" aria-label="Connector setup progress">
        {['Platform','Connection','Review'].map((label, index) => <span key={label} className={step >= index + 1 ? 'active' : ''}><b>{index + 1}</b>{label}</span>)}
      </div>

      {step === 1 && <div className="connector-platform-grid">
        {Object.entries(PLATFORMS).map(([type, platform]) => <button type="button" key={type} onClick={() => choose(type)}>
          <span><Server /></span><strong>{platform.label}</strong><small>{platform.description}</small><ChevronRight />
        </button>)}
      </div>}

      {step === 2 && <form className="connector-form" onSubmit={event => { event.preventDefault(); if (canContinue) setStep(3); }}>
        <div className="connector-form-grid">
          <label className="span-2">Connector name<input value={form.name} onChange={event => set('name', event.target.value)} maxLength={80} required placeholder="Production security source" /></label>
          <label>Protocol<select value={form.protocol} onChange={event => set('protocol', event.target.value)}><option value="https">HTTPS</option><option value="http">HTTP</option></select></label>
          <label>Port<input type="number" min="1" max="65535" value={form.port} onChange={event => set('port', event.target.value)} required /></label>
          <label className="span-2">Hostname or IP<input value={form.host} onChange={event => set('host', event.target.value)} required placeholder="security.example.internal" /></label>

          {form.connector_type === 'elastic' && <>
            <label className="span-2">Elastic API key<input type="password" value={form.api_key} onChange={event => set('api_key', event.target.value)} required={!editing} autoComplete="new-password" placeholder={editing ? 'Leave blank to keep existing key' : 'Paste the read-only API key'} /></label>
            <label>Alert alias<input value={form.alert_alias} onChange={event => set('alert_alias', event.target.value)} required /></label>
            <label>Raw-event indices<input value={form.event_indices} onChange={event => set('event_indices', event.target.value)} required /></label>
          </>}
          {form.connector_type === 'splunk' && <>
            <label>Authentication<select value={form.auth_scheme} onChange={event => set('auth_scheme', event.target.value)}><option value="Bearer">Bearer token</option><option value="Splunk">Splunk session key</option></select></label>
            <label>Index<input value={form.index} onChange={event => { set('index', event.target.value); if (form.search === `search index=${form.index}`) set('search', `search index=${event.target.value}`); }} required /></label>
            <label className="span-2">Authentication token<input type="password" value={form.token} onChange={event => set('token', event.target.value)} required={!editing} autoComplete="new-password" placeholder={editing ? 'Leave blank to keep existing token' : 'Paste the read-only token'} /></label>
            <label className="span-2">Base search<input value={form.search} onChange={event => set('search', event.target.value)} required /></label>
          </>}
          {form.connector_type === 'wazuh' && <>
            <label>Username<input value={form.username} onChange={event => set('username', event.target.value)} required autoComplete="username" /></label>
            <label>Index pattern<input value={form.index} onChange={event => set('index', event.target.value)} required /></label>
            <label className="span-2">Password<input type="password" value={form.password} onChange={event => set('password', event.target.value)} required={!editing} autoComplete="new-password" placeholder={editing ? 'Leave blank to keep existing password' : 'Enter the read-only password'} /></label>
          </>}
          <label className="connector-check span-2"><input type="checkbox" checked={form.verify_tls} disabled={form.protocol !== 'https'} onChange={event => set('verify_tls', event.target.checked)} /><span><strong>Verify the server certificate</strong><small>Required for trusted production connections.</small></span></label>
          {form.protocol === 'https' && <label className="span-2">Custom CA certificate <small>(optional when system trust is sufficient)</small><textarea rows="4" value={form.ca_certificate} onChange={event => set('ca_certificate', event.target.value)} placeholder={editing ? 'Leave blank to keep the existing CA certificate' : '-----BEGIN CERTIFICATE-----'} /></label>}
        </div>
        <footer className="connector-modal-actions"><button type="button" className="secondary-action" onClick={() => editing ? onClose() : setStep(1)}><ChevronLeft />{editing ? 'Cancel' : 'Back'}</button><button type="submit" className="primary-action" disabled={!canContinue}>Review <ChevronRight /></button></footer>
      </form>}

      {step === 3 && <form onSubmit={submit}>
        <div className="connector-review">
          <div><small>Platform</small><strong>{PLATFORMS[form.connector_type].label}</strong></div>
          <div><small>Endpoint</small><strong>{form.protocol}://{form.host}:{form.port}</strong></div>
          <div><small>Credentials</small><strong>{editing && !credentialProvided ? 'Keep encrypted credential' : 'Replace with supplied credential'}</strong></div>
          <div><small>TLS verification</small><strong>{form.verify_tls ? 'Enabled' : 'Disabled — lab use only'}</strong></div>
        </div>
        <div className="module-notice"><ShieldCheck /><span>Saving encrypts credentials on the API server and immediately performs a bounded read-only connection and search test. Activation remains a separate administrator decision.</span></div>
        {error && <div className="module-notice danger" role="alert">{error}</div>}
        <footer className="connector-modal-actions"><button type="button" className="secondary-action" onClick={() => setStep(2)}><ChevronLeft />Back</button><button type="submit" className="primary-action" disabled={saving}>{saving ? <RefreshCw className="animate-spin" /> : <Check />}{saving ? 'Saving and testing' : 'Save and test'}</button></footer>
      </form>}
    </section>
  </div>;
}

export default function ConnectorManager() {
  const [data, setData] = useState(null);
  const [wizard, setWizard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api('/admin/connectors')); }
    catch (error) { setNotice({ danger:true, text:error.message }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const connectors = useMemo(() => data?.connectors || [], [data]);
  const action = async (connector, name) => {
    setBusy(`${connector.id}:${name}`);
    setNotice(null);
    try {
      if (name === 'delete' && !globalThis.confirm(`Delete ${connector.name}? Stored alerts will remain.`)) return;
      const method = name === 'delete' ? 'DELETE' : 'POST';
      const path = name === 'delete' ? `/admin/connectors/${connector.id}` : `/admin/connectors/${connector.id}/${name}`;
      const result = await api(path, { method, ...(method === 'POST' ? { body:'{}' } : {}) });
      setNotice({ text:result.message || `${connector.name}: ${name} completed.` });
      await load();
    } catch (error) { setNotice({ danger:true, text:error.message }); }
    finally { setBusy(''); }
  };

  return <section className="module-panel connector-manager">
    <div className="panel-heading connector-manager-head"><div><PlugZap /><span><strong>Security source connectors</strong><small>Encrypted, tested, and switched without rebuilding the platform</small></span></div><div><button type="button" className="secondary-action" onClick={load} disabled={loading} aria-label="Refresh connectors"><RefreshCw className={loading ? 'animate-spin' : ''} /></button><button type="button" className="primary-action" onClick={() => setWizard({ mode:'create' })} disabled={data?.manager_available === false}><PlugZap />Add connector</button></div></div>

    {data?.manager_available === false && <div className="module-notice attention"><ShieldCheck /><span>Connector management is locked until the API server has a 32-byte <code>CONNECTOR_ENCRYPTION_KEY</code>. Environment sources continue operating as fallback.</span></div>}
    {notice && <div className={`module-notice ${notice.danger ? 'danger' : 'success'}`} role="status"><span>{notice.text}</span></div>}
    {!loading && data?.manager_available && !connectors.length && <div className="module-empty"><Database /><strong>No dashboard-managed connectors</strong><p>Add Elastic, Splunk, or Wazuh. The current environment source remains active until a tested connector is activated.</p></div>}

    <div className="connector-list">
      {connectors.map(connector => <article className={`connector-card ${connector.active ? 'active' : ''}`} key={connector.id}>
        <div className="connector-card-main"><span className="connector-icon"><Server /></span><div><div className="connector-title"><h3>{connector.name}</h3>{connector.active && <StatusBadge tone="success">Active source</StatusBadge>}<StatusBadge tone={connectorTone(connector)}>{connector.last_test_status === 'success' ? 'Tested' : connector.last_test_status === 'failure' ? 'Test failed' : connector.enabled ? 'Needs test' : 'Disabled'}</StatusBadge></div><p>{PLATFORMS[connector.connector_type]?.label} · {connector.endpoint}</p><div className="connector-facts"><span>Index <b>{connector.index || 'Default'}</b></span><span>TLS <b>{connector.verify_tls ? 'Verified' : 'Disabled'}</b></span><span>Credential <b>Encrypted</b></span><span>Last test <b>{fmtTs(connector.last_tested_at)}</b></span></div>{connector.last_test_error && <small className="connector-error">{connector.last_test_error}</small>}</div></div>
        <div className="connector-card-actions">
          <button type="button" onClick={() => action(connector, 'test')} disabled={Boolean(busy)}><RefreshCw className={busy === `${connector.id}:test` ? 'animate-spin' : ''} />Test</button>
          {!connector.active && <button type="button" onClick={() => action(connector, 'activate')} disabled={Boolean(busy) || connector.last_test_status !== 'success'}><Power />{connector.enabled ? 'Activate' : 'Enable & activate'}</button>}
          <button type="button" onClick={() => setWizard({ mode:'edit', connector })} disabled={Boolean(busy)}><Pencil />Edit</button>
          {connector.active ? <button type="button" onClick={() => action(connector, 'disable')} disabled={Boolean(busy)}><Power />Disable</button> : <button type="button" className="danger-text" onClick={() => action(connector, 'delete')} disabled={Boolean(busy)}><Trash2 />Delete</button>}
        </div>
      </article>)}
    </div>
    {wizard && <ConnectorWizard connector={wizard.connector || null} onClose={() => setWizard(null)} onSaved={(text, danger = false) => { setNotice({ text, danger }); load(); }} />}
  </section>;
}
