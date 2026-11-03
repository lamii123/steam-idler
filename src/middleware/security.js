const logger = require('../lib/logger');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function deny(res, message = 'Cross-origin request blocked') {
  return res.status(403).json({ error: message, code: 'forbidden' });
}

/**
 * Defense-in-depth for state-changing requests:
 *  - SameSite=Strict cookies already block most cross-site requests.
 *  - Sec-Fetch-Site catches browser-driven cross-site requests early.
 *  - Origin/Referer checks protect older clients that do not send Fetch Metadata.
 */
function sameOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    logger.warn('blocked cross-site request', { ip: req.ip, method: req.method, path: req.originalUrl, fetchSite });
    return deny(res);
  }

  const source = req.get('origin') || req.get('referer');
  if (!source) return deny(res, 'Missing Origin/Referer header');

  let sourceUrl;
  try {
    sourceUrl = new URL(source);
  } catch {
    return deny(res);
  }

  if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
    return deny(res);
  }

  // Compare host *and* port: two pages on the same hostname but different
  // ports are different origins.
  const requestHost = req.get('host');
  if (!requestHost || sourceUrl.host.toLowerCase() !== requestHost.toLowerCase()) {
    logger.warn('blocked origin mismatch', {
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
      origin: sourceUrl.origin,
      host: requestHost,
    });
    return deny(res);
  }

  // Never let a plain-HTTP page talk to an HTTPS deployment.
  if (req.protocol === 'https' && sourceUrl.protocol !== 'https:') {
    return deny(res);
  }

  next();
}

function noStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
}

function extraSecurityHeaders(_req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}

module.exports = { sameOriginGuard, noStore, extraSecurityHeaders };
