import { api } from './api.js';
import { byId } from './dom.js';
import { initAuth } from './auth.js';
import { createStatusPill } from './status.js';
import { initTheme, removeBgVideo } from './theme.js';
import { initProfile } from './profile.js';
import { initLibrary } from './library.js';
import { initIdle } from './idle.js';

const connectCard = byId('connectCard');
const dashboardCard = byId('dashboardCard');
const dashboardLoader = byId('dashboardLoader');

const updateStatusPill = createStatusPill();
const profile = initProfile();

initTheme();

let idle = null;
let dashboardLoadToken = 0;
let statusPollHandle = null;
let startQrFlow = null;

const library = initLibrary({
  onPlay: (appId) => idle?.idleGame(appId),
  onStop: () => idle?.stopIdle(),
});

idle = initIdle({
  getGames: () => library.getGames(),
  setStatus: updateStatusPill,
  onUnauthorized: showConnectCard,
  onActiveGame: (appId) => library.setIdleAppId(appId),
});

const auth = initAuth({ onConnected: enterDashboard });
startQrFlow = auth.startQrFlow;

function stopStatusPolling() {
  clearInterval(statusPollHandle);
  statusPollHandle = null;
}

function startStatusPolling() {
  stopStatusPolling();
  statusPollHandle = setInterval(() => idle.refreshStatus(), 30_000);
}

function showConnectCard() {
  dashboardLoadToken += 1;
  stopStatusPolling();
  idle.reset();
  removeBgVideo();
  dashboardCard.hidden = true;
  connectCard.hidden = false;
  dashboardLoader.hidden = true;
  dashboardLoader.setAttribute('aria-busy', 'false');

  if (startQrFlow) startQrFlow();
}

async function showDashboard() {
  const token = ++dashboardLoadToken;

  connectCard.hidden = true;
  dashboardCard.hidden = false;
  dashboardLoader.hidden = false;
  dashboardLoader.setAttribute('aria-busy', 'true');

  profile.showLoading();
  updateStatusPill('offline');
  idle.reset();

  api('/api/idle/prefs')
    .then((prefs) => {
      if (token !== dashboardLoadToken) return;
      idle.applyPrefs(prefs);
    })
    .catch(() => {});

  stopStatusPolling();

  try {
    const profileResult = await profile.loadProfile();
    if (token !== dashboardLoadToken) return;

    library.setGames(profileResult.games, {
      emptyMessage: profileResult.failed
        ? 'Could not load your game library. Check the server and try again.'
        : undefined,
    });
  } finally {
    if (token === dashboardLoadToken) {
      dashboardLoader.hidden = true;
      dashboardLoader.setAttribute('aria-busy', 'false');
    }
  }

  if (token !== dashboardLoadToken) return;

  await idle.refreshStatus();
  if (token !== dashboardLoadToken) return;

  startStatusPolling();
}

async function enterDashboard() {
  try {
    const me = await api('/api/auth/me');
    if (me.connected) {
      showDashboard();
      return;
    }
  } catch {
    // A failed check is treated the same as a logged-out visitor.
  }

  showConnectCard();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopStatusPolling();
  } else if (!dashboardCard.hidden) {
    idle.refreshStatus();
    startStatusPolling();
  }
});

window.addEventListener('beforeunload', stopStatusPolling);

enterDashboard();
