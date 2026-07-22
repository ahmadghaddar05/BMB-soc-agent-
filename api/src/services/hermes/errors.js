'use strict';

class HermesError extends Error {
  constructor(code, message, { status = 502, retriable = false, cause = null, details = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HermesError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
    this.details = details;
  }
}

function publicHermesError(error, requestId) {
  const known = error instanceof HermesError;
  return {
    status: known ? error.status : 502,
    body: {
      error: {
        code: known ? error.code : 'HERMES_UNAVAILABLE',
        message: known ? error.message : 'Hermes is currently unavailable',
        request_id: requestId,
      },
    },
  };
}

module.exports = { HermesError, publicHermesError };
