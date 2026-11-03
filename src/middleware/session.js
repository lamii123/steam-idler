const store = require('../db/store');
const crypto = require('../lib/crypto');
const config = require('../config');
const logger = require('../lib/logger');

const COOKIE_NAME = config.cookieSecure ? '__Host-sid' : 'sid';
const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
  };
}

function cookieOptions() {
  return {
    ...baseCookieOptions(),
    signed: true,
    maxAge: config.sessionLifetimeMs,
  };
}

function setSessionCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, baseCookieOptions());
}

function readSession(req, _res, next) {
  try {
    const sessionId = req.signedCookies?.[COOKIE_NAME];

    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
      req.steamSession = null;
      return next();
    }

    const record = store.get(sessionId);
    req.steamSession = record
      ? {
          sessionId,
          steamId: record.steamId,
          accountName: record.accountName,
          refreshToken: crypto.decrypt(record.encryptedRefreshToken),
        }
      : null;

    next();
  } catch (err) {
    logger.warn('could not read session', err.message);
    req.steamSession = null;
    next();
  }
}

function requireSession(req, res, next) {
  readSession(req, res, () => {
    if (!req.steamSession) {
      clearSessionCookie(res);
      return res.status(401).json({
        error: 'Not connected to Steam. Scan the QR code first.',
        code: 'session_expired',
      });
    }
    next();
  });
}

module.exports = {
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireSession,
};
