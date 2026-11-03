const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { createRouter } = require('./routes');
const { sameOriginGuard, noStore, extraSecurityHeaders } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errors');
const pkg = require('../package.json');

function createApp({ idleSessions, accounts, library } = {}) {
  if (!idleSessions || !accounts || !library) {
    throw new Error('createApp requires idleSessions, accounts and library adapters');
  }

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('env', config.nodeEnv);

  const cspDefaults = helmet.contentSecurityPolicy.getDefaultDirectives();
  if (!config.upgradeInsecureRequests) {
    delete cspDefaults['upgrade-insecure-requests'];
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          ...cspDefaults,
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'img-src': [
            "'self'",
            'data:',
            'https://*.steamstatic.com',
            'https://media.steampowered.com',
            'https://steamcommunity.com',
            'https://*.akamaihd.net',
          ],
          'media-src': [
            "'self'",
            'https://*.steamstatic.com',
            'https://media.steampowered.com',
            'https://steamcommunity.com',
            'https://*.akamaihd.net',
          ],
          'style-src': ["'self'"],
          'font-src': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  app.use(extraSecurityHeaders);
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(cookieParser(config.cookieSecret));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1200,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api', noStore, apiLimiter, sameOriginGuard);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      version: pkg.version,
    });
  });

  app.use('/api', createRouter({ idleSessions, accounts, library }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(
    express.static(publicDir, {
      dotfiles: 'ignore',
      etag: true,
      index: 'index.html',
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(css|js)$/.test(filePath)) {
          res.setHeader(
            'Cache-Control',
            config.isProduction ? 'public, max-age=3600' : 'no-cache'
          );
        }
      },
    })
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
