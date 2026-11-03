const STEAM_ASSET_HOSTS = [
  '.steamstatic.com',
  '.steampowered.com',
  '.steamcommunity.com',
  '.akamaihd.net',
];

/**
 * Only allow HTTPS Steam-hosted assets into `src` / CSS background URLs.
 */
export function safeSteamAssetUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (
      url.protocol === 'https:' &&
      STEAM_ASSET_HOSTS.some((suffix) => host.endsWith(suffix))
    ) {
      return url.toString();
    }
  } catch {
    // Invalid URLs are ignored.
  }

  return '';
}

/**
 * Keep profile links on the canonical Steam Community host.
 */
export function safeProfileUrl(value, steamId) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'steamcommunity.com') {
      return url.toString();
    }
  } catch {
    // Fall back to the canonical profile URL.
  }

  return steamId ? `https://steamcommunity.com/profiles/${steamId}` : '#';
}
