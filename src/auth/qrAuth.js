const QRCode = require('qrcode');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');

const crypto = require('../lib/crypto');
const config = require('../config');
const logger = require('../lib/logger');

const pending = new Map();
const SESSION_NAME = 'qrAuth';

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

async function start() {
  cleanupStale();

  if (pending.size >= config.maxPendingLogins) {
    throw new Error('Too many pending login attempts. Try again in a few minutes.');
  }

  const loginSession = new LoginSession(EAuthTokenPlatformType.SteamClient);
  loginSession.loginTimeout = config.qrLoginTtlMs;

  const pendingId = crypto.randomId(16);
  const entry = { status: 'pending', loginSession, createdAt: Date.now() };
  pending.set(pendingId, entry);

  loginSession.on('remoteInteraction', () => {
    logger.debug(`[${SESSION_NAME}] ${pendingId}: remote interaction`);
    entry.status = 'awaiting_confirmation';
  });

  loginSession.on('steamGuardMachineToken', () => {
    if (loginSession.steamGuardMachineToken) {
      entry.machineToken = loginSession.steamGuardMachineToken;
    }
  });

  loginSession.on('authenticated', () => {
    try {
      if (!loginSession.refreshToken || !loginSession.steamID) {
        throw new Error('Steam did not return a refresh token');
      }

      entry.steamId = loginSession.steamID.getSteamID64();
      entry.accountName = loginSession.accountName || '';
      entry.refreshToken = loginSession.refreshToken;
      entry.machineToken = entry.machineToken || loginSession.steamGuardMachineToken || null;
      entry.status = 'authenticated';

      logger.info(`[${SESSION_NAME}] authenticated`, { steamId: entry.steamId });
    } catch (err) {
      entry.status = 'error';
      entry.error = 'Could not complete Steam login';
      logger.error(`[${SESSION_NAME}] authentication handler failed`, err);
    }
  });

  loginSession.on('timeout', () => {
    entry.status = 'timeout';
  });

  loginSession.on('error', (err) => {
    entry.status = 'error';
    entry.error = 'Steam login failed';
    logger.warn(`[${SESSION_NAME}] login session error`, err.message);
  });

  try {
    const { qrChallengeUrl } = await loginSession.startWithQR();
    const qrDataUrl = await QRCode.toDataURL(qrChallengeUrl, { margin: 1, scale: 6 });
    return { pendingId, qrDataUrl };
  } catch (err) {
    pending.delete(pendingId);
    try {
      loginSession.cancelLoginAttempt();
    } catch {
      // Ignore cleanup failures.
    }
    throw err;
  }
}

function poll(pendingId) {
  const entry = pending.get(pendingId);

  if (!entry) return { status: 'expired' };

  if (entry.status === 'authenticated') {
    pending.delete(pendingId);
    return {
      status: 'authenticated',
      steamId: entry.steamId,
      accountName: entry.accountName,
      refreshToken: entry.refreshToken,
      machineToken: entry.machineToken,
    };
  }

  if (entry.status === 'timeout' || entry.status === 'error') {
    pending.delete(pendingId);
    return { status: entry.status, error: entry.error };
  }

  return { status: entry.status };
}

module.exports = { start, poll };
