const config = require('../config');
const { getJson, getHtml, isSteamAssetUrl } = require('../lib/http');
const { TtlCache } = require('../lib/cache');
const {
  assertSteamId,
  assertAppId,
  steamApiUrl,
  safeProfileUrl,
} = require('./steamApiUrls');

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new TtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: 500 });

async function getProfile(steamId) {
  assertSteamId(steamId);

  return cache.wrap(`profile:${steamId}`, async () => {
    if (!config.steamApiKey) return null;

    const [summaryResponse, levelResponse] = await Promise.all([
      getJson(
        steamApiUrl('ISteamUser', 'GetPlayerSummaries', 'v2', {
          key: config.steamApiKey,
          steamids: steamId,
        })
      ),
      getJson(
        steamApiUrl('IPlayerService', 'GetSteamLevel', 'v1', {
          key: config.steamApiKey,
          steamid: steamId,
        })
      ),
    ]);

    const player = summaryResponse?.response?.players?.[0];
    if (!player) return null;

    const avatar = [player.avatarfull, player.avatarmedium, player.avatar].find(
      (candidate) => candidate && isSteamAssetUrl(candidate)
    );

    return {
      name: String(player.personaname || 'Steam user').slice(0, 64),
      avatar: avatar || '',
      level: Number(levelResponse?.response?.player_level) || 0,
      profileUrl: safeProfileUrl(steamId, player.profileurl),
    };
  });
}

async function getOwnedGames(steamId) {
  assertSteamId(steamId);

  return cache.wrap(`games:${steamId}`, async () => {
    if (!config.steamApiKey) return null;

    const response = await getJson(
      steamApiUrl('IPlayerService', 'GetOwnedGames', 'v1', {
        key: config.steamApiKey,
        steamid: steamId,
        include_appinfo: '1',
        include_played_free_games: '1',
      })
    );

    const games = response?.response?.games || [];
    const totalCount = Number(response?.response?.game_count) || games.length;

    let totalMinutes = 0;
    for (const game of games) {
      totalMinutes += Number(game.playtime_forever) || 0;
    }

    return {
      totalCount,
      totalHours: Math.round(totalMinutes / 60),
      games: games
        .sort((a, b) => (Number(b.playtime_forever) || 0) - (Number(a.playtime_forever) || 0))
        .map((game) => ({
          appId: game.appid,
          name: String(game.name || `App ${game.appid}`).slice(0, 256),
          hours: Math.round((Number(game.playtime_forever) || 0) / 60),
          headerImage: game.img_logo_url
            ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`
            : `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
          isFree: !!game.is_free_game,
        })),
    };
  });
}

async function getProfileBackground(steamId) {
  assertSteamId(steamId);

  return cache.wrap(`bg:${steamId}`, async () => {
    if (!config.steamApiKey) return null;

    const result = { url: null, animated: false };

    try {
      const response = await getJson(
        steamApiUrl('IPlayerService', 'GetProfileBackground', 'v1', {
          key: config.steamApiKey,
          steamid: steamId,
        })
      );

      const background = response?.response?.profile_background;
      if (background?.image_large) {
        if (/^https?:\/\//i.test(background.image_large)) {
          if (isSteamAssetUrl(background.image_large)) {
            result.url = background.image_large;
          }
        } else {
          const assetPath = background.image_large.startsWith('/')
            ? background.image_large
            : `/${background.image_large}`;
          result.url = `https://cdn.akamai.steamstatic.com/steamcommunity/public/images${assetPath}`;
        }
      }
    } catch {
      // Backgrounds are optional decoration.
    }

    if (result.url) {
      try {
        const html = await getHtml(`https://steamcommunity.com/profiles/${steamId}`);
        const match = html.match(/src="([^"]+?\.webm)"/i);
        const candidate = match?.[1];

        if (candidate && isSteamAssetUrl(candidate)) {
          result.url = candidate;
          result.animated = true;
        }
      } catch {
        // Keep the static background if the profile page is unavailable.
      }
    }

    return result.url ? result : null;
  });
}

async function getPlayerBans(steamId) {
  assertSteamId(steamId);

  return cache.wrap(`bans:${steamId}`, async () => {
    if (!config.steamApiKey) {
      return { bannedAppIds: [], vacBanned: false, numBans: 0, numGameBans: 0 };
    }

    const response = await getJson(
      steamApiUrl('ISteamUser', 'GetPlayerBans', 'v1', {
        key: config.steamApiKey,
        steamids: steamId,
      })
    );

    const player = response?.players?.[0] || {};

    return {
      bannedAppIds: Array.isArray(player.BannedAppIds) ? player.BannedAppIds : [],
      vacBanned: !!player.VACBanned,
      numBans: Number(player.NumberOfVACBans) || 0,
      numGameBans: Number(player.NumberOfGameBans) || 0,
    };
  });
}

async function getGameDetails(appId) {
  const id = assertAppId(appId);

  return cache.wrap(`details:${id}`, async () => {
    try {
      const response = await getJson(
        `https://store.steampowered.com/api/appdetails?appids=${id}&l=english`
      );
      const data = response?.[String(id)];

      if (!data || data.status === false) return null;

      const info = data.data;
      return {
        description: String(info.short_description || '').slice(0, 5000),
        genres: (info.genres || [])
          .map((genre) => String(genre.description || '').slice(0, 64))
          .filter(Boolean),
        categories: (info.categories || [])
          .map((category) => String(category.description || '').slice(0, 64))
          .filter(Boolean),
      };
    } catch {
      return null;
    }
  });
}

/** Drops every cached Steam response for one account (used by `?refresh=1`). */
function clearCacheForSteamId(steamId) {
  assertSteamId(steamId);
  cache.delete(`profile:${steamId}`);
  cache.delete(`games:${steamId}`);
  cache.delete(`bg:${steamId}`);
  cache.delete(`bans:${steamId}`);
}

module.exports = {
  getProfile,
  getOwnedGames,
  getPlayerBans,
  getProfileBackground,
  getGameDetails,
  clearCacheForSteamId,
};
