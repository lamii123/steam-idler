/**
 * Mint a browser session for a freshly authenticated Steam account.
 *
 * Owns the "one live session per Steam account" invariant: any idler and any
 * stored record for the same account is replaced before the new record is
 * created, so both login flows cannot drift apart.
 */
const crypto = require('../lib/crypto');
const store = require('../db/store');

function createConnectAccount({ idleSessions }) {
  if (!idleSessions || typeof idleSessions.stop !== 'function') {
    throw new Error('createConnectAccount requires an idle sessions module');
  }

  function connectAccount({
    steamId,
    refreshToken,
    accountName = '',
    type = 'password',
    machineToken = null,
  }) {
    if (typeof steamId !== 'string' || !steamId) {
      throw new Error('steamId is required');
    }
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new Error('A Steam refresh token is required');
    }

    // Replacing a login must not leave a previous Steam client connected.
    idleSessions.stop(steamId);
    store.destroyBySteamId(steamId);

    const sessionId = crypto.randomId(32);
    store.create(steamId, crypto.encrypt(refreshToken), sessionId, accountName, type);

    if (machineToken) {
      store.setMachineToken(accountName, machineToken);
    }

    return { sessionId };
  }

  return { connectAccount };
}

module.exports = { createConnectAccount };
