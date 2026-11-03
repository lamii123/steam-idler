const SteamUser = require('steam-user');

const PICS_TIMEOUT_MS = 30_000;
const OWNERSHIP_WAIT_MS = 10_000;
const PRODUCT_INFO_TIMEOUT_MS = 15_000;
const PRODUCT_INFO_BATCH_SIZE = 100;
const MAX_GAMES = 10_000;

function waitForOwnership(client, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      client.removeListener('ownershipCached', onReady);
      reject(new Error('Timed out waiting for ownership cache'));
    }, timeoutMs);

    client.once('ownershipCached', onReady);
  });
}

async function getOwnedGamesViaSession(steamId, refreshToken, { idle } = {}) {
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('A refresh token is required');
  }
  if (!idle || typeof idle.status !== 'function' || typeof idle.ownedClient !== 'function') {
    throw new Error('An idle sessions module is required');
  }

  const idleStatus = idle.status(steamId);

  // Never log in with a second Steam client while the idler owns this account:
  // Steam treats that as another session and may disconnect the idler.
  if (idleStatus.connected) {
    const existingClient = idle.ownedClient(steamId);
    if (!existingClient) {
      throw new Error('The idler is still connecting to Steam; the game list is unavailable.');
    }

    let appIds = existingClient.getOwnedApps();
    if (appIds.length === 0) {
      await waitForOwnership(existingClient, OWNERSHIP_WAIT_MS);
      appIds = existingClient.getOwnedApps();
    }
    if (appIds.length === 0) {
      throw new Error('Steam did not expose an ownership cache for the active idler session.');
    }

    return buildGameList(existingClient, appIds);
  }

  const user = new SteamUser({
    enablePicsCache: true,
    changelistUpdateInterval: 0,
  });

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      user.removeAllListeners();
      try {
        user.logOff();
      } catch {
        // The socket may already be closed.
      }
    };

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(value);
    };

    const timeout = setTimeout(() => {
      finish(new Error('Steam session timed out while fetching the game list'));
    }, PICS_TIMEOUT_MS);

    user.once('ownershipCached', async () => {
      try {
        const appIds = user.getOwnedApps();
        const result = await buildGameList(user, appIds);
        finish(null, result);
      } catch (err) {
        finish(err);
      }
    });

    user.once('error', (err) => finish(err));

    user.logOn({ refreshToken });
  });
}

function getProductInfo(client, batch) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Steam product info request timed out'));
    }, PRODUCT_INFO_TIMEOUT_MS);

    client.getProductInfo(batch, [], true, (err, apps, _packages, unknownApps) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve({ apps, unknownApps });
    });
  });
}

async function buildGameList(client, appIds) {
  const games = [];
  const ids = Array.isArray(appIds) ? appIds.slice(0, MAX_GAMES) : [];

  for (let i = 0; i < ids.length; i += PRODUCT_INFO_BATCH_SIZE) {
    const batch = ids.slice(i, i + PRODUCT_INFO_BATCH_SIZE);
    const result = await getProductInfo(client, batch);
    const unknown = new Set(result.unknownApps || []);

    for (const id of batch) {
      if (unknown.has(id)) continue;

      games.push({
        appId: id,
        name: result.apps?.[id]?.appinfo?.common?.name || `App ${id}`,
        // The session path knows names but not playtime or free-to-play status.
        hours: null,
        headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,
        isFree: null,
        isVacBanned: false,
      });
    }
  }

  games.sort((a, b) => a.name.localeCompare(b.name));

  return {
    totalCount: games.length,
    totalHours: null,
    games,
  };
}

module.exports = { getOwnedGamesViaSession };
