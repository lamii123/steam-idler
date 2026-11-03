/**
 * One HTTP error contract. A known outcome maps to exactly one status, code
 * and message; anything else is an internal failure and must not be echoed to
 * the browser.
 */
const ERROR_STATUS = Object.freeze({
  invalidRequest: 400,
  sessionExpired: 401,
  badCredentials: 401,
  notFound: 404,
  forbidden: 403,
  conflict: 409,
  steamUnavailable: 502,
  notConfigured: 503,
});

class ClientError extends Error {
  constructor(code, message) {
    const status = ERROR_STATUS[code];
    if (!status) throw new Error(`Unknown client error code: ${code}`);

    super(message);
    this.name = 'ClientError';
    this.code = code;
    this.status = status;
  }
}

function clientError(code, message) {
  return new ClientError(code, message);
}

function isClientError(err) {
  return err instanceof ClientError;
}

module.exports = { ERROR_STATUS, ClientError, clientError, isClientError };
