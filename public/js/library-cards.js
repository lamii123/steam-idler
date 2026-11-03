import { setPressed } from './dom.js';

export const PLAY_ACTIVE_CLASS = 'game-card__play-btn--active';
const ICON_PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,3 20,12 6,21"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>`;

export function gameLabel(game) {
  return game.name || `App ${game.appId}`;
}

export function playtimeLabel(hours) {
  if (hours === null || hours === undefined) return 'Hours unavailable';
  return hours > 0 ? `${hours}h played` : 'Not played';
}

export function setPlayButtonState(button, isActive, label) {
  setPressed(button, isActive, PLAY_ACTIVE_CLASS);
  button.setAttribute('aria-label', `${isActive ? 'Stop idling' : 'Idle'} ${label}`);
  button.innerHTML = isActive ? ICON_PAUSE : ICON_PLAY;
}

export function renderGameCard(
  game,
  { onPlay = () => {}, onStop = () => {}, onToggle = () => {} } = {}
) {
  const label = gameLabel(game);

  const card = document.createElement('div');
  card.className = 'game-card';
  card.dataset.appid = game.appId;
  card.setAttribute('role', 'listitem');

  const art = document.createElement('div');
  art.className = 'game-card__art';

  if (game.headerImage) {
    const img = document.createElement('img');
    img.src = game.headerImage;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 460;
    img.height = 215;
    art.appendChild(img);
  } else {
    art.className = 'game-card__art game-card__art--empty';
    art.textContent = label.slice(0, 2);
  }

  const overlay = document.createElement('div');
  overlay.className = 'game-card__overlay';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'game-card__play-btn';
  playBtn.dataset.appid = game.appId;
  setPlayButtonState(playBtn, false, label);

  overlay.appendChild(playBtn);
  art.appendChild(overlay);

  const body = document.createElement('div');
  body.className = 'game-card__body';

  const title = document.createElement('p');
  title.className = 'game-card__title';

  const titleLink = document.createElement('a');
  titleLink.href = `https://store.steampowered.com/app/${game.appId}`;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = `${label} (${game.appId})`;
  titleLink.addEventListener('click', (event) => event.stopPropagation());
  title.appendChild(titleLink);

  const badges = document.createElement('div');
  badges.className = 'game-card__badges';

  if (game.isFree) {
    const freeBadge = document.createElement('span');
    freeBadge.className = 'game-card__badge game-card__badge--free';
    freeBadge.textContent = 'Free';
    badges.appendChild(freeBadge);
  }

  if (game.isVacBanned) {
    const vacBadge = document.createElement('span');
    vacBadge.className = 'game-card__badge game-card__badge--vac';
    vacBadge.textContent = 'VAC';
    badges.appendChild(vacBadge);
  }

  const row = document.createElement('div');
  row.className = 'game-card__row';

  const hours = document.createElement('span');
  hours.className = 'game-card__hours';
  hours.textContent = playtimeLabel(game.hours);

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'game-card__expand';
  expandBtn.textContent = 'Show more';
  expandBtn.setAttribute('aria-expanded', 'false');

  row.appendChild(hours);
  row.appendChild(expandBtn);
  body.appendChild(title);
  if (badges.children.length > 0) body.appendChild(badges);
  body.appendChild(row);

  const details = document.createElement('div');
  details.className = 'game-card__details';

  const detailsContent = document.createElement('div');
  detailsContent.className = 'game-card__details-content';

  if (game.isVacBanned) {
    const vacRow = document.createElement('div');
    vacRow.className = 'game-card__detail';
    vacRow.innerHTML = `<span class="game-card__detail-label">VAC</span><span class="game-card__detail-value game-card__detail-value--danger">Banned</span>`;
    detailsContent.appendChild(vacRow);
  }

  details.appendChild(detailsContent);
  card.appendChild(art);
  card.appendChild(body);
  card.appendChild(details);

  card.addEventListener('click', (event) => {
    if (event.target.closest('button, a')) return;
    onToggle(card);
  });

  expandBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    onToggle(card);
  });

  playBtn.addEventListener('click', (event) => {
    event.stopPropagation();

    if (playBtn.classList.contains(PLAY_ACTIVE_CLASS)) {
      onStop();
    } else {
      onPlay(game.appId);
    }
  });

  return card;
}

export function renderListItem(game, { onPlay = () => {}, onStop = () => {} } = {}) {
  const label = gameLabel(game);

  const item = document.createElement('li');
  item.className = 'lib-item';
  item.dataset.appid = game.appId;

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'lib-item__action';
  setPressed(action, false, null);
  action.setAttribute('aria-label', `Idle ${label}`);

  if (game.headerImage) {
    const img = document.createElement('img');
    img.className = 'lib-item__thumb';
    img.src = game.headerImage;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 92;
    img.height = 43;
    action.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'lib-item__thumb lib-item__thumb--empty';
    action.appendChild(placeholder);
  }

  const name = document.createElement('span');
  name.className = 'lib-item__name';
  name.textContent = label;
  action.appendChild(name);

  if (game.isVacBanned) {
    const badge = document.createElement('span');
    badge.className = 'game-badge game-badge--ban';
    badge.textContent = 'VAC';
    action.appendChild(badge);
  }

  if (game.hours === null || game.hours === undefined) {
    const hours = document.createElement('span');
    hours.className = 'lib-item__hours';
    hours.textContent = 'n/a';
    hours.title = 'Hours unavailable';
    action.appendChild(hours);
  } else if (game.hours > 0) {
    const hours = document.createElement('span');
    hours.className = 'lib-item__hours';
    hours.textContent = `${game.hours}h`;
    action.appendChild(hours);
  }

  action.addEventListener('click', () => {
    const isActive = action.getAttribute('aria-pressed') === 'true';

    if (isActive) {
      onStop();
    } else {
      onPlay(game.appId);
    }
  });

  item.appendChild(action);
  return item;
}
