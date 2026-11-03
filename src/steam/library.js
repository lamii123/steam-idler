const logger = require('../lib/logger');
const { TtlCache } = require('../lib/cache');
const defaultSteamApi = require('./steamApi');
const defaultSessionApi = require('./steamUserApi');

const LIBRARY_TTL_MS = 10 * 60 * 1000;
const SOURCE = Object.freeze({
  WEB: 'web',
  SESSION: 'session',
  NONE: 'none',
});

/**
 * One shape for both Steam sources. `hours: null` means "unknown" and is not
 * the same fact as "not played"; the cards render it explicitly instead of
 * claiming every game has zero playtime.
 */
function normalizeGame(game) {
  const appId = Number(game?.appId);
  if (!Number.isInteger(appId) || appId <= 0 || appId > 0xffffffff) return null;

  const rawHours = game.hours;
  const hours =
    rawHours === null || rawHours === undefined ? null : Math.max(0, Math.round(Number(rawHours)));

  return {
    appId,
    name: String(game.name || `App ${appId}`).slice(0, 256),
    hours: Number.isFinite(hours) ? hours : null,
    headerImage:
      typeof game.headerImage === 'string' && game.headerImage
        ? game.headerImage
        : `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    isFree: typeof game.isFree === 'boolean' ? game.isFree : null,
  };
}

function normalize(source, result) {
  const games = (Array.isArray(result?.games) ? result.games : [])
    .map(normalizeGame)
    .filter(Boolean);

  const totalHoursKnown = source === SOURCE.WEB;
  const totalHours = totalHoursKnown
    ? Math.max(0, Math.round(Number(result?.totalHours) || 0))
    : null;

  games.sort((a, b) => {
    if (a.hours === null && b.hours === null) return a.name.localeCompare(b.name);
    if (a.hours === null) return 1;
    if (b.hours === null) return -1;
    return b.hours - a.hours || a.name.localeCompare(b.name);
  });

  return {
    source,
    totalCount: Number.isFinite(Number(result?.totalCount))
      ? Number(result.totalCount)
      : games.length,
    totalHours,
    totalHoursKnown,
    games,
  };
}

/**
 * Owns the "which games does this account own" question. The Web API adapter
 * and the session adapter are interchangeable sources; this module chooses
 * one, normalises the answer, and caches the successful result per account.
 */
function createLibrary({
  idle,
  steamApi = defaultSteamApi,
  sessionApi = defaultSessionApi,
  logger: log = logger,
  ttlMs = LIBRARY_TTL_MS,
  maxEntries = 500,
} = {}) {
  if (!idle) throw new Error('createLibrary requires an idle sessions module');

  const cache = new TtlCache({ ttlMs, maxEntries });

  async function load(steamId, refreshToken) {
    let webError = null;

    try {
      const web = await steamApi.getOwnedGames(steamId);
      if (web && Array.isArray(web.games) && web.games.length > 0) {
        return normalize(SOURCE.WEB, web);
      }
    } catch (err) {
      webError = err;
      log.warn('library: web game list failed', { steamId, message: err.message });
    }

    if (!refreshToken) {
      return normalize(SOURCE.NONE, { games: [], totalCount: 0, totalHours: 0 });
    }

    try {
      const session = await sessionApi.getOwnedGamesViaSession(steamId, refreshToken, { idle });
      return normalize(SOURCE.SESSION, session);
    } catch (err) {
      log.warn('library: session game list failed', {
        steamId,
        message: err.message,
        webFailed: Boolean(webError),
      });
      throw err;
    }
  }

  async function games(steamId, { refreshToken = '', refresh = false } = {}) {
    const key = `library:${steamId}`;
    if (refresh) cache.delete(key);

    const cached = cache.get(key);
    if (cached) return cached;

    const result = await load(steamId, refreshToken);
    if (result.source !== SOURCE.NONE) cache.set(key, result);
    return result;
  }

  function clear(steamId) {
    cache.delete(`library:${steamId}`);
  }

  return { games, clear };
}

module.exports = { createLibrary, normalize, SOURCE };
