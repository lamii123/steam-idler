const DETAILS_CACHE_LIMIT = 500;

/**
 * DOMParser documents are inert: scripts do not run and event attributes never
 * fire. Never replace this with innerHTML on a live element.
 */
export function stripHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html').documentElement.textContent;
}

export function populateDetails(card, details) {
  const content = card.querySelector('.game-card__details-content');
  if (!content) return;

  const existing = content.querySelector('.game-card__dynamic');
  if (existing) existing.remove();
  if (!details) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'game-card__dynamic';

  if (details.description) {
    const description = document.createElement('p');
    description.className = 'game-card__desc';
    description.textContent = stripHtml(details.description);
    wrapper.appendChild(description);
  }

  const allTags = [...(details.genres || []), ...(details.categories || [])];

  if (allTags.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'game-card__tags';

    allTags.forEach((tag) => {
      const pill = document.createElement('span');
      pill.className = 'game-card__tag';
      pill.textContent = tag;
      tags.appendChild(pill);
    });

    wrapper.appendChild(tags);
  }

  content.appendChild(wrapper);
}

/**
 * Small TTL-free LRU-ish cache: details are immutable enough for a session,
 * and the oldest entry is evicted once the cap is reached.
 */
export function createDetailsCache(limit = DETAILS_CACHE_LIMIT) {
  const cache = new Map();

  async function fetchDetails(appId) {
    if (cache.has(appId)) return cache.get(appId);

    try {
      const res = await fetch(`/api/games/${appId}/details`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) return null;

      const data = await res.json();
      cache.set(appId, data);

      if (cache.size > limit) {
        cache.delete(cache.keys().next().value);
      }

      return data;
    } catch {
      const empty = { description: '', genres: [], categories: [] };
      cache.set(appId, empty);
      return empty;
    }
  }

  function clear() {
    cache.clear();
  }

  return { fetchDetails, clear };
}
