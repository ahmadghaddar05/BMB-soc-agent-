'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configHash,
  decryptSecrets,
  encryptSecrets,
  managerAvailable,
  publicConnector,
  safeConnectorError,
  validateConnectorInput,
} = require('../src/services/connectors');

const connectorEnv = { CONNECTOR_ENCRYPTION_KEY:Buffer.alloc(32, 7).toString('base64') };

test('connector credentials use authenticated encryption and never enter the public contract', () => {
  const encrypted = encryptSecrets({ token:'secret-token', ca_certificate:'certificate' }, connectorEnv);
  assert.notEqual(encrypted.secret_ciphertext, 'secret-token');
  assert.deepEqual(decryptSecrets(encrypted, connectorEnv), {
    token:'secret-token', ca_certificate:'certificate',
  });
  assert.throws(
    () => decryptSecrets(encrypted, { CONNECTOR_ENCRYPTION_KEY:Buffer.alloc(32, 8).toString('base64') }),
    /could not be decrypted/
  );

  const publicValue = publicConnector({
    id:'connector-1', name:'Production Splunk', connector_type:'splunk',
    config:{ protocol:'https', host:'splunk.internal', port:8089, verify_tls:true, index:'security' },
    enabled:true, active:false, ca_certificate_configured:true,
  });
  assert.equal(publicValue.endpoint, 'https://splunk.internal:8089');
  assert.equal(publicValue.credential_configured, true);
  assert.equal(JSON.stringify(publicValue).includes('secret-token'), false);
  assert.equal(Object.hasOwn(publicValue, 'secret_ciphertext'), false);
});

test('connector validation produces bounded source-specific configuration', () => {
  const elastic = validateConnectorInput({
    connector_type:'elastic', name:'Client Elastic', host:'10.1.1.20', port:9200,
    api_key:'encoded-api-key', alert_alias:'.alerts-security.alerts-default', event_indices:'logs-*',
  });
  assert.equal(elastic.type, 'elastic');
  assert.equal(elastic.config.verify_tls, true);
  assert.equal(elastic.secrets.api_key, 'encoded-api-key');

  const splunk = validateConnectorInput({
    connector_type:'splunk', name:'Client Splunk', host:'10.1.1.160', port:8089,
    token:'jwt-token', index:'security', search:'search index=security', auth_scheme:'Bearer',
    collection_mode:'triggered_alerts', namespace_owner:'-', namespace_app:'search',
  });
  assert.equal(splunk.config.auth_scheme, 'Bearer');
  assert.equal(splunk.config.port, 8089);
  assert.equal(splunk.config.collection_mode, 'triggered_alerts');
  assert.equal(splunk.config.namespace_app, 'search');

  assert.throws(() => validateConnectorInput({
    connector_type:'splunk', name:'Unsafe', host:'127.0.0.1', token:'token',
  }), /not allowed/);
  assert.throws(() => validateConnectorInput({
    connector_type:'splunk', name:'Bad index', host:'10.1.1.160', token:'token', index:'security;delete',
  }), /index contains unsupported characters/);
});

test('activation test identity changes with configuration and encrypted credentials', () => {
  const encrypted = encryptSecrets({ token:'one' }, connectorEnv);
  const row = {
    connector_type:'splunk', config:{ protocol:'https', host:'10.1.1.160', port:8089 },
    ...encrypted,
  };
  assert.notEqual(configHash(row), configHash({ ...row, config:{ ...row.config, port:8090 } }));
  assert.equal(managerAvailable(connectorEnv), true);
  assert.equal(managerAvailable({}), false);
});

test('connector failures redact credentials before persistence or display', () => {
  const safe = safeConnectorError(new Error('Authorization: Bearer abc.def token=hidden password=hunter2'));
  assert.equal(safe.includes('abc.def'), false);
  assert.equal(safe.includes('hidden'), false);
  assert.equal(safe.includes('hunter2'), false);
});
