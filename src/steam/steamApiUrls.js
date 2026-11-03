const config = require('../config');

function assertSteamId(steamId) {
  if (!/^\d{17}$/.test(String(steamId))) {
    throw new Error('Invalid Steam ID');
  }
}

function assertAppId(appId) {
  const value = Number(appId);
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) {
    throw new Error('Invalid app ID');
  }
  return value;
}

function steamApiUrl(interfaceName, method, version, params) {
  const url = new URL(
    `https://api.steampowered.com/${interfaceName}/${method}/${version}/`
  );

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function safeProfileUrl(steamId, candidate) {
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && url.hostname === 'steamcommunity.com') {
      return url.toString();
    }
  } catch {
    // Fall through to the canonical profile URL.
  }
  return `https://steamcommunity.com/profiles/${steamId}`;
}

module.exports = {
  assertSteamId,
  assertAppId,
  steamApiUrl,
  safeProfileUrl,
};
