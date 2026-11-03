const express = require('express');

const { requireSession } = require('../middleware/session');
const {
  getProfile,
  getPlayerBans,
  getProfileBackground,
  clearCacheForSteamId,
} = require('../steam/steamApi');
const { isSteamAssetUrl } = require('../lib/http');
const config = require('../config');
const store = require('../db/store');
const logger = require('../lib/logger');
const { TtlCache } = require('../lib/cache');
const { clientError } = require('../lib/clientError');

const EMPTY_LIBRARY = Object.freeze({
  source: 'none',
  totalCount: 0,
  totalHours: null,
  totalHoursKnown: false,
  games: [],
});

function createProfileRoutes({ idleSessions, library }) {
  const router = express.Router();
  router.use(requireSession);

  // A forced refresh clears the profile cache and can trigger several Steam
  // requests. Allow it at most once a minute per session.
  const refreshCooldown = new TtlCache({ ttlMs: 60_000, maxEntries: 1000 });

  router.get('/', async (req, res) => {
    const { steamId, sessionId, refreshToken } = req.steamSession;

    if (!/^\d{17}$/.test(String(steamId))) {
      throw clientError('invalidRequest', 'Invalid Steam session');
    }

    if (req.query.refresh === '1' && !refreshCooldown.get(sessionId)) {
      refreshCooldown.set(sessionId, true);
      store.clearCachedProfile(sessionId);
      clearCacheForSteamId(steamId);
      library.clear(steamId);
    }

    const cached = store.getCachedProfile(sessionId);
    if (cached) return res.json(cached);

    if (!config.steamApiKey) {
      throw clientError('notConfigured', 'STEAM_API_KEY not configured on server');
    }

    const [profileResult, gamesResult, bansResult, backgroundResult] = await Promise.allSettled([
      getProfile(steamId),
      library.games(steamId, { refreshToken }),
      getPlayerBans(steamId),
      getProfileBackground(steamId),
    ]);

    for (const [name, result] of [
      ['profile', profileResult],
      ['games', gamesResult],
      ['bans', bansResult],
      ['background', backgroundResult],
    ]) {
      if (result.status === 'rejected') {
        logger.warn(`profile: ${name} request failed`, {
          steamId,
          message: result.reason?.message,
        });
      }
    }

    let profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
    const games = gamesResult.status === 'fulfilled' ? gamesResult.value : EMPTY_LIBRARY;
    const bans = bansResult.status === 'fulfilled' ? bansResult.value : null;
    const background = backgroundResult.status === 'fulfilled' ? backgroundResult.value : null;

    if (!profile) {
      const client = idleSessions.ownedClient(steamId);
      const persona = client?.users?.[steamId];
      const avatarCandidate =
        persona?.avatar_url_full || persona?.avatar_url_medium || persona?.avatar_url_icon || '';

      profile = {
        name: String(client?.accountInfo?.name || 'Steam user').slice(0, 64),
        avatar: avatarCandidate && isSteamAssetUrl(avatarCandidate) ? avatarCandidate : '',
        level: 0,
        profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
      };
    }

    const bannedAppIds = new Set((bans?.bannedAppIds || []).map(Number));
    const enrichedGames = games.games.map((game) => ({
      ...game,
      isVacBanned: bannedAppIds.has(Number(game.appId)),
    }));

    if (background) {
      profile.profileBackground = background;
    }

    const response = {
      profile,
      games: { ...games, games: enrichedGames },
    };

    store.setCachedProfile(sessionId, response);
    res.json(response);
  });

  return router;
}

module.exports = { createProfileRoutes };
