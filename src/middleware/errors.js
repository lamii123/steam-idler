const logger = require('../lib/logger');
const { isClientError } = require('../lib/clientError');

function notFound(req, res) {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found', code: 'notFound' });
  }
  res.status(404).type('text/plain').send('Not found');
}

/* eslint-disable-next-line no-unused-vars -- errorHandler must accept 4 args for Express to treat it as an error handler */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Body parser errors are client errors, not server errors.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body', code: 'invalidRequest' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large', code: 'invalidRequest' });
  }

  if (isClientError(err)) {
    if (err.status >= 500) {
      logger.warn('request failed upstream', {
        method: req.method,
        path: req.originalUrl,
        code: err.code,
        message: err.message,
      });
    }
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  const status =
    Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;

  if (status >= 500) {
    logger.error(
      'unhandled request error',
      {
        method: req.method,
        path: req.originalUrl,
        message: err.message,
      },
      err
    );
    return res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }

  res.status(status).json({ error: err.message || 'Request failed' });
}

module.exports = { notFound, errorHandler };
