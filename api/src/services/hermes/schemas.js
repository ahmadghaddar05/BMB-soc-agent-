'use strict';

const Ajv = require('ajv');
const { HermesError } = require('./errors');

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const EVIDENCE_TYPES = [
  'alert', 'incident', 'alert_group', 'asset', 'identity', 'observable', 'fetch_run',
  'investigation', 'case', 'action_request', 'raw_event',
];
const TRIAGE_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
const TRIAGE_VERDICTS = ['true_positive', 'false_positive', 'needs_investigation', 'benign_anomaly'];
const CORRELATION_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];

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
            type: { enum: EVIDENCE_TYPES },
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
  analystTurn: {
    oneOf: [
      {
        type: 'object', required: ['type', 'tool', 'arguments'],
        properties: {
          type: { const: 'tool_call' },
          tool: { type: 'string', minLength: 1, maxLength: 100 },
          arguments: { type: 'object' },
        },
        additionalProperties: false,
      },
      {
        type: 'object', required: ['type', 'answer', 'citations', 'confidence'],
        properties: {
          type: { const: 'final' },
          answer: { type: 'string', minLength: 1, maxLength: 8000 },
          citations: {
            type: 'array', maxItems: 40,
            items: {
              type: 'object', required: ['type', 'id'],
              properties: {
                type: { enum: EVIDENCE_TYPES },
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
    ],
  },
  triageTurn: {
    oneOf: [
      {
        type: 'object', required: ['type', 'tool', 'arguments'],
        properties: {
          type: { const: 'tool_call' },
          tool: { type: 'string', minLength: 1, maxLength: 100 },
          arguments: { type: 'object' },
        },
        additionalProperties: false,
      },
      {
        type: 'object',
        required: [
          'type', 'severity', 'verdict', 'confidence', 'attack_stage',
          'key_findings', 'recommended_actions', 'narrative', 'citations',
        ],
        properties: {
          type: { const: 'final' },
          severity: { enum: TRIAGE_SEVERITIES },
          verdict: { enum: TRIAGE_VERDICTS },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          attack_stage: { type: 'string', minLength: 1, maxLength: 100 },
          key_findings: {
            type: 'array', minItems: 1, maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 500 },
          },
          recommended_actions: {
            type: 'array', minItems: 1, maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 500 },
          },
          narrative: { type: 'string', minLength: 1, maxLength: 3000 },
          citations: {
            type: 'array', minItems: 1, maxItems: 20,
            items: {
              type: 'object', required: ['type', 'id'],
              properties: {
                type: { enum: EVIDENCE_TYPES },
                id: { type: 'string', minLength: 1, maxLength: 256 },
              },
              additionalProperties: false,
            },
          },
          limitations: {
            type: 'array', maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  correlationOutput: {
    type: 'object', required: ['incidents'],
    properties: {
      incidents: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object',
          required: [
            'title', 'severity', 'confidence', 'alert_ids', 'attack_stages',
            'common_entities', 'narrative', 'recommended_actions',
          ],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            severity: { enum: CORRELATION_SEVERITIES },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            alert_ids: {
              type: 'array', minItems: 2, maxItems: 80, uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 256 },
            },
            attack_stages: {
              type: 'array', maxItems: 12, uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 100 },
            },
            common_entities: {
              type: 'object', required: ['users', 'hosts', 'ips'],
              properties: {
                users: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 256 } },
                hosts: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 256 } },
                ips: { type: 'array', maxItems: 40, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 256 } },
              },
              additionalProperties: false,
            },
            narrative: { type: 'string', minLength: 1, maxLength: 3000 },
            recommended_actions: {
              type: 'array', minItems: 1, maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 500 },
            },
          },
          additionalProperties: false,
        },
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

function parseJsonOutput(raw) {
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
  return value;
}

function parseChatOutput(raw) {
  return validate('chatOutput', parseJsonOutput(raw), 'HERMES_INVALID_OUTPUT');
}

function parseAnalystTurn(raw) {
  return validate('analystTurn', parseJsonOutput(raw), 'HERMES_INVALID_OUTPUT');
}

function parseTriageTurn(raw) {
  return validate('triageTurn', parseJsonOutput(raw), 'HERMES_INVALID_OUTPUT');
}

function parseCorrelationOutput(raw) {
  return validate('correlationOutput', parseJsonOutput(raw), 'HERMES_INVALID_OUTPUT');
}

function validateCitations(output, evidence) {
  const valid = Object.fromEntries(EVIDENCE_TYPES.map(type => [type, new Set()]));
  if (Array.isArray(evidence)) {
    for (const item of evidence) {
      if (valid[item?.type] && item?.id != null) valid[item.type].add(String(item.id));
    }
  } else {
    for (const item of evidence?.alerts || []) valid.alert.add(String(item.id));
    for (const item of evidence?.incidents || []) valid.incident.add(String(item.id));
  }
  const invalid = output.citations.filter(citation => !valid[citation.type]?.has(String(citation.id)));
  if (invalid.length) {
    throw new HermesError('HERMES_UNGROUNDED_OUTPUT', 'Hermes cited evidence that was not supplied', {
      status: 502,
      details: invalid.slice(0, 8),
    });
  }
  return output;
}

module.exports = {
  CORRELATION_SEVERITIES, EVIDENCE_TYPES, TRIAGE_SEVERITIES, TRIAGE_VERDICTS,
  parseAnalystTurn, parseChatOutput, parseCorrelationOutput, parseTriageTurn,
  schemas, validate, validateCitations,
};
