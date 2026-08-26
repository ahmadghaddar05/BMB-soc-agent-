'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROFILE_ID,
  listAiModelProfiles,
  modelIdentity,
  resolveAiModelProfile,
  routingOptions,
} = require('../src/services/ai-model-profiles');

const config = { hermesModel:'hermes-agent' };

test('AI model profiles default to the existing Hermes route', () => {
  const profile = resolveAiModelProfile({}, config);
  assert.equal(profile.id, DEFAULT_PROFILE_ID);
  assert.equal(profile.hermesProvider, null);
  assert.equal(profile.hermesModel, 'hermes-agent');
  assert.deepEqual(routingOptions(profile), { model:'hermes-agent' });
  assert.equal(modelIdentity(profile), 'gateway_default:hermes-agent');
});

test('Llama profile uses the exact allowlisted OpenRouter route through Hermes', () => {
  const profile = resolveAiModelProfile({ ai_model_profile:'llama_3_3_70b' }, config);
  assert.equal(profile.hermesProvider, 'openrouter');
  assert.equal(profile.hermesModel, 'meta-llama/llama-3.3-70b-instruct');
  assert.deepEqual(routingOptions(profile), {
    model:'meta-llama/llama-3.3-70b-instruct',
    provider:'openrouter',
  });
  assert.equal(modelIdentity(profile), 'openrouter:meta-llama/llama-3.3-70b-instruct');
});

test('unknown stored model profiles fail safely to the configured Hermes default', () => {
  const profiles = listAiModelProfiles({ ai_model_profile:'not-allowlisted' }, config);
  assert.equal(profiles.active_profile_id, DEFAULT_PROFILE_ID);
  assert.equal(profiles.fallback_applied, true);
  assert.equal(profiles.profiles.some(profile => Object.hasOwn(profile, 'secret')), false);
  assert.equal(JSON.stringify(profiles).includes('OPENROUTER_API_KEY='), false);
});
