import { api } from './api.js';
import { byId } from './dom.js';
import { applyUserTheme } from './theme.js';
import { safeProfileUrl, safeSteamAssetUrl } from './steam-url.js';

const DEFAULT_AVATAR =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#1a1f27"/><text x="40" y="55" text-anchor="middle" fill="#4c6c8c" font-size="32" font-family="sans-serif" font-weight="600">?</text></svg>'
  );

export function initProfile() {
  const profileAvatar = byId('profileAvatar');
  const profileName = byId('profileName');
  const profileLevel = byId('profileLevel');
  const profileStats = byId('profileStats');

  function showLoading() {
    profileName.textContent = 'Loading…';
    profileAvatar.removeAttribute('src');
    profileLevel.textContent = '';
    profileStats.textContent = '';
  }

  async function loadProfile() {
    try {
      const data = await api('/api/profile');
      const profile = data.profile || {};
      const games = data.games || {
        source: 'none',
        totalCount: 0,
        totalHours: null,
        games: [],
      };

      profileName.textContent = profile.name || 'Steam user';
      profileName.href = safeProfileUrl(profile.profileUrl, profile.steamId);

      const avatar = safeSteamAssetUrl(profile.avatar || '');
      if (avatar) {
        profileAvatar.src = avatar;
        profileAvatar.alt = `Avatar of ${profile.name || 'Steam user'}`;
      } else {
        profileAvatar.alt = '';
        profileAvatar.src = DEFAULT_AVATAR;
      }

      profileLevel.textContent = profile.level ? `Level ${profile.level}` : '';

      if (games.source === 'session') {
        // The session path knows which games are owned but not their playtime.
        profileStats.textContent = games.totalCount
          ? `${games.totalCount} games · hours unavailable`
          : 'Game list unavailable';
      } else if (games.source === 'web' && games.totalCount) {
        profileStats.textContent = `${games.totalCount} games · ${games.totalHours}h played`;
      } else {
        profileStats.textContent = '';
      }

      applyUserTheme(profile);

      return {
        games: Array.isArray(games.games) ? games.games : [],
        failed: false,
      };
    } catch (err) {
      // Profile loading is best-effort; the dashboard still works without it.
      profileName.textContent = 'Profile unavailable';
      profileName.href = '#';
      profileStats.textContent = '';
      return { games: [], failed: true };
    }
  }

  return { loadProfile, showLoading };
}
