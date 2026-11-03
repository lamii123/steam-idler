const express = require('express');
const rateLimit = require('express-rate-limit');

const qrAuth = require('../auth/qrAuth');
const passwordAuth = require('../auth/passwordAuth');
const store = require('../db/store');
const config = require('../config');
const logger = require('../lib/logger');
const { clientError } = require('../lib/clientError');
const {
  setSessionCookie,
  clearSessionCookie,
  readSession,
} = require('../middleware/session');

const QR_COOKIE = 'qr_pending';
const QR_COOKIE_PATH = '/api/auth/qr';
const PENDING_ID_PATTERN = /^[a-f0-9]{32}$/;

function qrCookieOptions(includeMaxAge = false) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: QR_COOKIE_PATH,
    signed: true,
    ...(includeMaxAge ? { maxAge: config.qrLoginTtlMs } : {}),
  };
}

function createAuthRoutes({ idleSessions, accounts }) {
  const { connectAccount } = accounts;
  const router = express.Router();

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function setQrCookie(res, pendingId) {
    res.cookie(QR_COOKIE, pendingId, qrCookieOptions(true));
  }

  function clearQrCookie(res) {
    res.clearCookie(QR_COOKIE, qrCookieOptions(false));
  }

  function completeLogin(res, credentials) {
    const { sessionId } = connectAccount(credentials);
    setSessionCookie(res, sessionId);
    return sessionId;
  }

  router.post('/qr/start', authLimiter, async (_req, res) => {
    try {
      const { pendingId, qrDataUrl } = await qrAuth.start();
      setQrCookie(res, pendingId);
      res.json({ pendingId, qrDataUrl });
    } catch (err) {
      logger.warn('could not start QR login', err.message);
      throw clientError('steamUnavailable', 'Could not start a Steam login session. Try again.');
    }
  });

  router.get('/qr/poll/:pendingId', (req, res) => {
    const { pendingId } = req.params;

    if (!PENDING_ID_PATTERN.test(pendingId)) {
      throw clientError('invalidRequest', 'Invalid login ID');
    }

    const cookiePendingId = req.signedCookies?.[QR_COOKIE];
    if (!cookiePendingId || cookiePendingId !== pendingId) {
      clearQrCookie(res);
      throw clientError(
        'forbidden',
        'This QR login belongs to another browser. Request a new code.'
      );
    }

    const result = qrAuth.poll(pendingId);

    if (result.status === 'authenticated') {
      clearQrCookie(res);

      try {
        completeLogin(res, {
          steamId: result.steamId,
          refreshToken: result.refreshToken,
          accountName: result.accountName,
          type: 'qr',
          machineToken: result.machineToken,
        });
      } catch (err) {
        logger.error('could not mint a session after QR login', err);
        throw clientError('steamUnavailable', 'Could not complete Steam login.');
      }

      return res.json({
        status: 'authenticated',
        steamId: result.steamId,
        accountName: result.accountName,
      });
    }

    if (result.status === 'timeout' || result.status === 'error' || result.status === 'expired') {
      clearQrCookie(res);
    }

    res.json(result);
  });

  router.post('/password', authLimiter, async (req, res) => {
    const { accountName, password } = req.body || {};

    if (typeof accountName !== 'string' || typeof password !== 'string') {
      throw clientError('invalidRequest', 'Account name and password are required');
    }

    const trimmedAccountName = accountName.trim();
    if (
      !trimmedAccountName ||
      !password ||
      trimmedAccountName.length > 64 ||
      password.length > 256
    ) {
      throw clientError('invalidRequest', 'Account name and password are required');
    }

    try {
      const result = await passwordAuth.start(trimmedAccountName, password);

      if (result.authenticated) {
        completeLogin(res, {
          steamId: result.steamId,
          refreshToken: result.refreshToken,
          accountName: trimmedAccountName,
          type: 'password',
          machineToken: result.machineToken,
        });
        return res.json({ connected: true, steamId: result.steamId });
      }

      if (result.needsGuard) {
        return res.json({
          needsGuard: true,
          pendingId: result.pendingId,
          guardTypes: result.guardTypes,
        });
      }

      throw clientError('steamUnavailable', 'Steam did not return a usable login result.');
    } catch (err) {
      if (err.code === 'steamUnavailable') throw err;

      logger.warn('password login failed', { message: err.message });

      // The Steam message heuristic is the adapter's concern, not a route condition.
      const code = passwordAuth.toClientError(err);
      throw clientError(
        code,
        code === 'badCredentials'
          ? 'Invalid account name or password'
          : 'Steam login failed. Try again in a moment.'
      );
    }
  });

  router.post('/password/guard', authLimiter, async (req, res) => {
    const { pendingId, code } = req.body || {};

    if (typeof pendingId !== 'string' || !PENDING_ID_PATTERN.test(pendingId)) {
      throw clientError('invalidRequest', 'A valid pendingId is required');
    }
    if (typeof code !== 'string' || !code.trim()) {
      throw clientError('invalidRequest', 'A Steam Guard code is required');
    }

    try {
      const result = await passwordAuth.submitGuardCode(pendingId, code);

      if (result.authenticated) {
        completeLogin(res, {
          steamId: result.steamId,
          refreshToken: result.refreshToken,
          accountName: result.accountName || '',
          type: 'password',
          machineToken: result.machineToken,
        });
        return res.json({ connected: true, steamId: result.steamId });
      }

      if (result.error === 'expired') {
        throw clientError('sessionExpired', 'Login session expired. Please try again.');
      }

      if (result.error === 'timeout') {
        throw clientError('sessionExpired', 'Steam Guard code timed out. Please try again.');
      }

      throw clientError('badCredentials', 'Steam Guard code rejected.');
    } catch (err) {
      if (err.code === 'sessionExpired' || err.code === 'badCredentials') throw err;

      logger.warn('guard code submission failed', { message: err.message });
      throw clientError('steamUnavailable', 'Steam Guard verification failed. Try again.');
    }
  });

  router.get('/me', readSession, (req, res) => {
    if (!req.steamSession) return res.json({ connected: false });

    res.json({
      connected: true,
      steamId: req.steamSession.steamId,
      accountName: req.steamSession.accountName,
    });
  });

  router.post('/logout', authLimiter, readSession, (req, res) => {
    if (req.steamSession) {
      idleSessions.stop(req.steamSession.steamId);
      store.destroy(req.steamSession.sessionId);
    }

    clearSessionCookie(res);
    clearQrCookie(res);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRoutes };
