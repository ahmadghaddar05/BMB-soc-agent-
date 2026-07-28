'use strict';

const { runtimeConfig } = require('../config');

const DEFAULT_PROFILE_ID = 'gpt_5_6_sol';
const SETTING_KEY = 'ai_model_profile';

const PROFILE_DEFINITIONS = Object.freeze({
  gpt_5_6_sol: Object.freeze({
    id: 'gpt_5_6_sol',
    label: 'GPT-5.6 Sol',
    providerLabel: 'Hermes default route',
    hermesProvider: null,
    description: 'Uses the existing authenticated model route configured in the Hermes gateway.',
    credentialLabel: 'Existing Hermes/Codex authentication',
    secretEnvironmentVariable: null,
  }),
  llama_3_3_70b: Object.freeze({
    id: 'llama_3_3_70b',
    label: 'Meta Llama 3.3 70B',
    providerLabel: 'OpenRouter through Hermes',
    hermesProvider: 'openrouter',
    hermesModel: 'meta-llama/llama-3.3-70b-instruct',
    description: 'Routes new BMB analysis runs to Meta Llama 3.3 70B through OpenRouter and the same Hermes safety boundary.',
    credentialLabel: 'OPENROUTER_API_KEY in the Hermes host environment',
    secretEnvironmentVariable: 'OPENROUTER_API_KEY',
  }),
});

function profileDefinition(profileId) {
  return PROFILE_DEFINITIONS[profileId] || null;
}

function resolveAiModelProfile(settings = {}, config = runtimeConfig()) {
  const requestedId = String(settings[SETTING_KEY] || DEFAULT_PROFILE_ID);
  const definition = profileDefinition(requestedId) || PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID];
  const fallback = !profileDefinition(requestedId);
  return {
    ...definition,
    hermesModel: definition.hermesModel || config.hermesModel,
    requestedId,
    fallback,
  };
}

function publicProfile(profile, activeId = null) {
  return {
    id: profile.id,
    label: profile.label,
    provider: profile.providerLabel,
    model: profile.hermesModel,
    description: profile.description,
    credential: profile.credentialLabel,
    credential_location: profile.secretEnvironmentVariable ? 'hermes_host' : 'hermes_gateway',
    active: profile.id === activeId,
  };
}

function listAiModelProfiles(settings = {}, config = runtimeConfig()) {
  const active = resolveAiModelProfile(settings, config);
  const profiles = Object.values(PROFILE_DEFINITIONS).map(definition =>
    publicProfile({
      ...definition,
      hermesModel: definition.hermesModel || config.hermesModel,
    }, active.id)
  );
  return {
    active_profile_id: active.id,
    requested_profile_id: active.requestedId,
    fallback_applied: active.fallback,
    profiles,
  };
}

function modelIdentity(profile) {
  return `${profile.hermesProvider || 'gateway_default'}:${profile.hermesModel}`;
}

function routingOptions(profile) {
  return {
    model: profile.hermesModel,
    ...(profile.hermesProvider ? { provider: profile.hermesProvider } : {}),
  };
}

module.exports = {
  DEFAULT_PROFILE_ID,
  PROFILE_DEFINITIONS,
  SETTING_KEY,
  listAiModelProfiles,
  modelIdentity,
  profileDefinition,
  publicProfile,
  resolveAiModelProfile,
  routingOptions,
};
