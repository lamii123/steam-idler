const { LoginSession, EAuthTokenPlatformType } = require('steam-session');

const config = require('../config');
const crypto = require('../lib/crypto');
const store = require('../db/store');
const logger = require('../lib/logger');

const pending = new Map();
const SESSION_NAME = 'passwordAuth';
const GUARD_TIMEOUT_MS = 15_000;

function cleanupStale() {
  const now = Date.now();

  for (const [id, entry] of pending.entries()) {
    if (now - entry.createdAt <= config.qrLoginTtlMs) continue;

    try {
      entry.loginSession.cancelLoginAttempt();
    } catch {
      // The Steam session may already be gone.
    }
    pending.delete(id);
  }
}

const cleanupTimer = setInterval(cleanupStale, 60_000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

// Ensure the interval is cleared when the process exits.
process.on('exit', () => clearInterval(cleanupTimer));

function validateCredentials(accountName, password) {
  if (typeof accountName !== 'string' || !accountName.trim() || accountName.length > 64) {
    throw new Error('Invalid account name');
  }
  if (typeof password !== 'string' || !password || password.length > 256) {
    throw new Error('Invalid password');
  }
}

function registerSessionListeners(loginSession, entry, pendingId) {
  loginSession.on('authenticated', () => {
    if (!loginSession.refreshToken || !loginSession.steamID) return;

    entry.status = 'authenticated';
    entry.steamId = loginSession.steamID.getSteamID64();
    entry.refreshToken = loginSession.refreshToken;
    logger.debug(`[${SESSION_NAME}] ${pendingId}: authenticated`, { steamId: entry.steamId });
  });

  loginSession.on('steamGuardMachineToken', () => {
    if (loginSession.steamGuardMachineToken) {
      entry.machineToken = loginSession.steamGuardMachineToken;
    }
  });

  loginSession.on('timeout', () => {
    entry.status = 'timeout';
  });

  loginSession.on('error', (err) => {
    entry.status = 'error';
    entry.error = err.message || String(err);
    logger.warn(`[${SESSION_NAME}] ${pendingId}: login session error`, entry.error);
  });
}

async function start(accountName, password) {
  cleanupStale();
  validateCredentials(accountName, password);

  if (pending.size >= config.maxPendingLogins) {
    throw new Error('Too many pending login attempts. Try again in a few minutes.');
  }

  const loginSession = new LoginSession(EAuthTokenPlatformType.SteamClient);
  const pendingId = crypto.randomId(16);
  const entry = {
    status: 'pending',
    loginSession,
    accountName: accountName.trim(),
    createdAt: Date.now(),
  };

  pending.set(pendingId, entry);
  registerSessionListeners(loginSession, entry, pendingId);

  try {
    const options = { accountName: entry.accountName, password };

    const existingToken = store.getMachineToken(entry.accountName);
    if (existingToken) {
      options.steamGuardMachineToken = existingToken;
    }

    const result = await loginSession.startWithCredentials(options);

    if (result.actionRequired) {
      const guardTypes = (result.validActions || []).map((action) => ({
        type: String(action.type || ''),
        detail: String(action.detail || ''),
      }));

      entry.status = 'guard_required';
      entry.guardTypes = guardTypes;
      return { pendingId, needsGuard: true, guardTypes };
    }

    if (!loginSession.steamID || !loginSession.refreshToken) {
      throw new Error('Steam did not return a refresh token');
    }

    pending.delete(pendingId);

    return {
      pendingId,
      authenticated: true,
      steamId: loginSession.steamID.getSteamID64(),
      refreshToken: loginSession.refreshToken,
      machineToken: entry.machineToken || loginSession.steamGuardMachineToken || null,
    };
  } catch (err) {
    pending.delete(pendingId);
    throw err;
  }
}

async function submitGuardCode(pendingId, code) {
  const entry = pending.get(pendingId);

  if (!entry) return { error: 'expired' };
  if (entry.status !== 'guard_required') return { error: 'not_waiting_for_guard' };

  const guardCode = String(code || '').trim();
  if (!guardCode || guardCode.length > 16) return { error: 'invalid_code' };

  entry.status = 'authenticating';

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;

      clearTimeout(timer);
      entry.loginSession.removeListener('authenticated', onAuthenticated);
      entry.loginSession.removeListener('error', onError);
      entry.loginSession.removeListener('timeout', onTimeout);

      if (result.authenticated) {
        pending.delete(pendingId);
      } else {
        entry.status = 'guard_required';
      }

      resolve(result);
    };

    const onAuthenticated = () => {
      if (!entry.loginSession.steamID || !entry.loginSession.refreshToken) {
        return finish({ error: 'no_refresh_token' });
      }

      const steamId = entry.loginSession.steamID.getSteamID64();
      const refreshToken = entry.loginSession.refreshToken;
      const machineToken = entry.machineToken || entry.loginSession.steamGuardMachineToken || null;

      finish({
        authenticated: true,
        steamId,
        refreshToken,
        accountName: entry.accountName,
        machineToken,
      });
    };

    const onError = (err) => {
      finish({ error: err.message || 'Steam Guard code rejected' });
    };

    const onTimeout = () => {
      finish({ error: 'timeout' });
    };

    const timer = setTimeout(() => finish({ error: 'timeout' }), GUARD_TIMEOUT_MS);

    entry.loginSession.once('authenticated', onAuthenticated);
    entry.loginSession.once('error', onError);
    entry.loginSession.once('timeout', onTimeout);

    entry.loginSession.submitSteamGuardCode(guardCode).catch((err) => {
      finish({ error: err.message || 'Steam Guard code rejected' });
    });
  });
}

/**
 * Steam reports credential failures as prose. Keep the heuristic in this
 * adapter so routes only deal in contract codes.
 */
function toClientError(err) {
  return /invalid|incorrect|password|account name|rate.?limit|too many/i.test(err?.message || '')
    ? 'badCredentials'
    : 'steamUnavailable';
}

module.exports = { start, submitGuardCode, toClientError };
