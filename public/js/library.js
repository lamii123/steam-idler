import { byId, setPressed } from './dom.js';
import { PLAY_ACTIVE_CLASS } from './library-cards.js';
import {
  gameLabel,
  renderGameCard,
  renderListItem,
  setPlayButtonState,
} from './library-cards.js';
import { createDetailsCache, populateDetails } from './library-details.js';
import { layoutCards } from './library-layout.js';
import { VirtualList } from './virtual-list.js';

const ITEM_HEIGHT = 43;
const DEFAULT_EMPTY_TEXT = 'No games found.';

function readSavedView() {
  try {
    return localStorage.getItem('library-view');
  } catch {
    // Storage can be disabled by browser privacy settings.
    return null;
  }
}

/**
 * Create the game library controller. The module owns rendering, search, view
 * mode, and active-game state; card markup and layout live in their own files.
 */
export function initLibrary({ onPlay = () => {}, onStop = () => {} } = {}) {
  const gameSearch = byId('gameSearch');
  const libraryGrid = byId('libraryGrid');
  const libraryScroll = document.querySelector('.library__scroll');
  const libraryList = byId('libraryList');
  const libraryCount = byId('libraryCount');
  const libraryEmpty = byId('libraryEmpty');
  const viewToggle = byId('viewToggle');

  let allGames = [];
  let gamesById = new Map();
  let displayedGames = [];
  let expandedCard = null;
  let activeAppId = null;
  let emptyText = DEFAULT_EMPTY_TEXT;
  let viewMode = readSavedView() === 'list' ? 'list' : 'grid';
  let virtualList = null;
  let searchDebounce;
  let resizeTimer;

  const detailsCache = createDetailsCache();

  const cardContext = {
    onPlay,
    onStop,
    onToggle: toggleExpansion,
  };

  const listContext = { onPlay, onStop };

  if (!libraryScroll) {
    throw new Error('Missing required element .library__scroll');
  }

  function updateViewButtons() {
    viewToggle.querySelectorAll('.view-toggle__btn').forEach((button) => {
      setPressed(button, button.dataset.view === viewMode);
    });
  }

  function updateListActiveState() {
    libraryList.querySelectorAll('.lib-item').forEach((item) => {
      const appId = Number(item.dataset.appid);
      const isActive = appId === activeAppId;
      item.classList.toggle('lib-item--active', isActive);

      const action = item.querySelector('.lib-item__action');
      if (!action) return;

      const game = gamesById.get(appId);
      const label = game ? gameLabel(game) : appId;

      setPressed(action, isActive, null);
      action.setAttribute('aria-label', `${isActive ? 'Stop idling' : 'Idle'} ${label}`);
    });
  }

  function matchesQuery(game, query) {
    return (
      gameLabel(game).toLowerCase().includes(query) || String(game.appId).includes(query)
    );
  }

  function render() {
    libraryCount.textContent =
      displayedGames.length === 1 ? '1 game' : `${displayedGames.length} games`;
    libraryEmpty.hidden = displayedGames.length > 0;

    const hasQuery = gameSearch.value.trim().length > 0;
    const nextEmptyText = hasQuery ? 'No games match your search.' : emptyText;

    if (libraryEmpty.textContent !== nextEmptyText) {
      libraryEmpty.textContent = nextEmptyText;
    }

    if (viewMode === 'grid') {
      libraryScroll.hidden = false;
      libraryList.hidden = true;
      expandedCard = null;

      const fragment = document.createDocumentFragment();
      displayedGames.forEach((game) => {
        fragment.appendChild(renderGameCard(game, cardContext));
      });
      libraryGrid.replaceChildren(fragment);

      if (activeAppId !== null && activeAppId !== undefined) {
        setIdleAppId(activeAppId);
      }

      layoutCards(libraryGrid);
    } else {
      libraryScroll.hidden = true;
      libraryList.hidden = false;

      if (!virtualList) {
        virtualList = new VirtualList(
          libraryList,
          ITEM_HEIGHT,
          (game) => renderListItem(game, listContext),
          updateListActiveState
        );
      }

      virtualList.setItems(displayedGames);

      if (activeAppId !== null && activeAppId !== undefined) {
        updateListActiveState();
      }
    }
  }

  async function toggleExpansion(card) {
    if (expandedCard && expandedCard !== card) {
      expandedCard.classList.remove('game-card--expanded');
      const previousBtn = expandedCard.querySelector('.game-card__expand');
      if (previousBtn) {
        previousBtn.textContent = 'Show more';
        previousBtn.setAttribute('aria-expanded', 'false');
      }
    }

    const wasExpanded = card.classList.contains('game-card--expanded');
    card.classList.toggle('game-card--expanded');
    expandedCard = card.classList.contains('game-card--expanded') ? card : null;

    const expandBtn = card.querySelector('.game-card__expand');
    if (expandBtn) {
      expandBtn.textContent = wasExpanded ? 'Show more' : 'Show less';
      expandBtn.setAttribute('aria-expanded', String(!wasExpanded));
    }

    if (!wasExpanded && expandedCard) {
      const appId = Number(card.dataset.appid);
      const details = await detailsCache.fetchDetails(appId);

      if (!card.isConnected) return;
      populateDetails(card, details);
    }

    layoutCards(libraryGrid);
  }

  function setView(mode) {
    if (mode !== 'grid' && mode !== 'list') return;
    if (mode === viewMode) return;

    viewMode = mode;

    try {
      localStorage.setItem('library-view', mode);
    } catch {
      // The view still changes for this page even if storage is unavailable.
    }

    updateViewButtons();
    render();
  }

  function setGames(games, { emptyMessage } = {}) {
    allGames = Array.isArray(games) ? games : [];
    gamesById = new Map(allGames.map((game) => [game.appId, game]));
    displayedGames = [...allGames];
    emptyText = emptyMessage || DEFAULT_EMPTY_TEXT;
    expandedCard = null;
    detailsCache.clear();
    render();
  }

  function setIdleAppId(appId) {
    const previousAppId = activeAppId;
    activeAppId = appId;

    const changedAppIds = new Set(
      [previousAppId, appId].filter((id) => id !== null && id !== undefined)
    );

    changedAppIds.forEach((id) => {
      const isActive = id === appId;
      const game = gamesById.get(id);
      const label = game ? gameLabel(game) : id;

      libraryGrid
        .querySelectorAll(`.game-card__play-btn[data-appid="${id}"]`)
        .forEach((button) => {
          if (button.classList.contains(PLAY_ACTIVE_CLASS) === isActive) {
            return;
          }

          setPlayButtonState(button, isActive, label);
        });
    });

    if (viewMode === 'list') updateListActiveState();
  }

  function getGames() {
    return allGames;
  }

  gameSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const query = gameSearch.value.toLowerCase().trim();

      displayedGames = query
        ? allGames.filter((game) => matchesQuery(game, query))
        : [...allGames];

      render();
    }, 120);
  });

  document.addEventListener('keydown', (event) => {
    const tagName = document.activeElement?.tagName;

    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) {
      event.preventDefault();
      gameSearch.focus();
    }
  });

  gameSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      gameSearch.value = '';
      gameSearch.dispatchEvent(new Event('input'));
      gameSearch.blur();
    }
  });

  viewToggle.addEventListener('click', (event) => {
    const button = event.target.closest('.view-toggle__btn');
    if (!button) return;
    setView(button.dataset.view);
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (viewMode === 'grid') layoutCards(libraryGrid);
    }, 150);
  });

  updateViewButtons();

  return { setGames, setView, setIdleAppId, getGames };
}
