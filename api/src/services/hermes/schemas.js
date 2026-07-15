'use strict';

const Ajv = require('ajv');
const { HermesError } = require('./errors');

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });

const schemas = {
  capabilities: {
    type: 'object',
    required: ['object', 'platform', 'model', 'auth', 'features'],
    properties: {
      object: { const: 'hermes.api_server.capabilities' },
      platform: { const: 'hermes-agent' },
      model: { type: 'string', minLength: 1, maxLength: 200 },
      auth: {
        type: 'object', required: ['type', 'required'],
        properties: { type: { const: 'bearer' }, required: { const: true } },
        additionalProperties: true,
      },
      features: { type: 'object', additionalProperties: true },
      endpoints: { type: 'object', additionalProperties: true },
      session_key_header: { type: 'string' },
    },
    additionalProperties: true,
  },
  models: {
    type: 'object', required: ['data'],
    properties: {
      object: { type: 'string' },
      data: {
        type: 'array', minItems: 1,
        items: {
          type: 'object', required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 200 } },
          additionalProperties: true,
        },
      },
    },
    additionalProperties: true,
  },
  toolsets: {
    type: 'array',
    items: {
      type: 'object', required: ['name', 'enabled', 'configured', 'tools'],
      properties: {
        name: { type: 'string', minLength: 1 },
        label: { type: 'string' },
        description: { type: 'string' },
        enabled: { type: 'boolean' },
        configured: { type: 'boolean' },
        tools: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
      additionalProperties: true,
    },
  },
  runStart: {
    type: 'object', required: ['run_id', 'status'],
    properties: {
      run_id: { type: 'string', minLength: 1, maxLength: 256 },
      status: { type: 'string', minLength: 1, maxLength: 64 },
    },
    additionalProperties: true,
  },
  runStatus: {
    type: 'object', required: ['run_id', 'status'],
    properties: {
      object: { type: 'string' },
      run_id: { type: 'string', minLength: 1, maxLength: 256 },
      status: { enum: ['started', 'queued', 'running', 'stopping', 'completed', 'failed', 'cancelled', 'pending_approval'] },
      session_id: { type: ['string', 'null'] },
      model: { type: ['string', 'null'] },
      output: { type: ['string', 'null'] },
      error: { type: ['string', 'object', 'null'] },
      usage: {
        type: ['object', 'null'],
        properties: {
          input_tokens: { type: 'integer', minimum: 0 },
          output_tokens: { type: 'integer', minimum: 0 },
          total_tokens: { type: 'integer', minimum: 0 },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  chatOutput: {
    type: 'object', required: ['answer', 'citations', 'confidence'],
    properties: {
      answer: { type: 'string', minLength: 1, maxLength: 8000 },
      citations: {
        type: 'array', maxItems: 40,
        items: {
          type: 'object', required: ['type', 'id'],
          properties: {
            type: { enum: ['alert', 'incident'] },
            id: { type: 'string', minLength: 1, maxLength: 256 },
          },
          additionalProperties: false,
        },
      },
      confidence: { enum: ['low', 'medium', 'high'] },
      limitations: {
        type: 'array', maxItems: 10,
        items: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
    additionalProperties: false,
  },
};

const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]));

function validate(name, value, code = 'HERMES_PROTOCOL_ERROR') {
  const validator = validators[name];
  if (!validator(value)) {
    throw new HermesError(code, 'Hermes returned an incompatible response', {
      status: 502,
      details: validator.errors?.map(error => `${error.instancePath || '/'} ${error.message}`).slice(0, 8),
    });
  }
  return value;
}

function parseChatOutput(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new HermesError('HERMES_INVALID_OUTPUT', 'Hermes returned an empty response', { status: 502 });
  }
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1];
  let value;
  try { value = JSON.parse(text); }
  catch {
    throw new HermesError('HERMES_INVALID_OUTPUT', 'Hermes returned invalid structured output', { status: 502 });
  }
  return validate('chatOutput', value, 'HERMES_INVALID_OUTPUT');
}

function validateCitations(output, evidence) {
  const valid = {
    alert: new Set((evidence.alerts || []).map(item => String(item.id))),
    incident: new Set((evidence.incidents || []).map(item => String(item.id))),
  };
  const invalid = output.citations.filter(citation => !valid[citation.type].has(String(citation.id)));
  if (invalid.length) {
    throw new HermesError('HERMES_UNGROUNDED_OUTPUT', 'Hermes cited evidence that was not supplied', {
      status: 502,
      details: invalid.slice(0, 8),
    });
  }
  return output;
}

module.exports = { parseChatOutput, schemas, validate, validateCitations };
