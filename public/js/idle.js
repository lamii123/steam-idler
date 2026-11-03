import { api } from './api.js';
import { byId, setPressed } from './dom.js';
import { formatClock } from './format.js';
import { idleView } from './idle-view.js';

/**
 * Create the idle controller. Dependencies are passed in by the composition
 * root so the module does not need to import the library or profile modules.
 */
export function initIdle({
  getGames = () => [],
  setStatus = () => {},
  onUnauthorized = () => {},
  onActiveGame = () => {},
} = {}) {
  const odometer = byId('odometer');
  const odometerLabel = byId('odometerLabel');
  const stopBtn = byId('stopBtn');
  const idleError = byId('idleError');
  const disconnectBtn = byId('disconnectBtn');
  const currentGameBlock = byId('currentGameBlock');
  const currentGameThumb = byId('currentGameThumb');
  const currentGameName = byId('currentGameName');
  const currentGameMeta = byId('currentGameMeta');
  const durationPresets = byId('durationPresets');
  const personaToggle = byId('personaToggle');

  let tickHandle = null;
  let selectedDuration = 0;
  let currentStopAt = null;
  let wasIdling = false;
  let idling = false;
  let personaTouched = false;

  const games = () => {
    const value = getGames();
    return Array.isArray(value) ? value : [];
  };

  function setCurrentGame(game) {
    const timer = currentGameBlock.querySelector('.current-game__timer');

    if (!game) {
      currentGameBlock.hidden = true;
      currentGameThumb.removeAttribute('src');
      currentGameThumb.alt = '';
      timer.hidden = true;
      return;
    }

    currentGameBlock.hidden = false;
    timer.hidden = false;
    const label = game.name || `App ${game.appId}`;
    currentGameName.textContent = label;
    currentGameMeta.textContent = `App ID ${game.appId}`;

    if (game.headerImage) {
      currentGameThumb.src = game.headerImage;
      currentGameThumb.alt = label;
    } else {
      currentGameThumb.removeAttribute('src');
      currentGameThumb.alt = '';
    }
  }

  function setIdlingUI(isIdling, since, appIds, stopAt) {
    clearInterval(tickHandle);
    currentStopAt = stopAt || null;

    if (isIdling && since) {
      const allGames = games();
      const game =
        appIds && appIds.length > 0
          ? allGames.find((item) => item.appId === appIds[0]) || {
              name: `App ${appIds[0]}`,
              appId: appIds[0],
            }
          : null;

      setCurrentGame(game);

      if (currentStopAt) {
        odometerLabel.textContent = 'Remaining';

        const tick = () => {
          const remaining = Math.max(0, currentStopAt - Date.now());
          odometer.textContent = formatClock(remaining);
          odometer.setAttribute('aria-label', `Time remaining: ${formatClock(remaining)}`);

          if (remaining <= 0) {
            setIdlingUI(false, null, null, null);
          }
        };

        tick();
        if (currentStopAt) {
          tickHandle = setInterval(tick, 1000);
        }
      } else {
        odometerLabel.textContent = 'Elapsed';

        const tick = () => {
          const elapsed = formatClock(Date.now() - since);
          odometer.textContent = elapsed;
          odometer.setAttribute('aria-label', `Time elapsed: ${elapsed}`);
        };

        tick();
        tickHandle = setInterval(tick, 1000);
      }
    } else {
      odometer.textContent = '00:00:00';
      odometer.setAttribute('aria-label', 'Idle timer');
      odometerLabel.textContent = 'Remaining';
      setCurrentGame(null);
    }
  }

  function reset() {
    setIdlingUI(false, null, null, null);
    wasIdling = false;
    idling = false;
    personaTouched = false;
    onActiveGame(null);
  }

  function idleGame(appId) {
    if (idling) return;
    idling = true;
    idleError.textContent = '';

    const allGames = games();
    const game = allGames.find((item) => item.appId === appId);
    setCurrentGame(game || { name: `App ${appId}`, appId, headerImage: '' });

    // Optimistically mark the card as active so the UI responds instantly.
    onActiveGame(appId);

    odometer.textContent = '…';
    odometerLabel.textContent = 'Connecting';
    setStatus('idling');

    const body = {
      appIds: [appId],
      duration: selectedDuration,
      appearOnline: personaToggle.checked,
    };

    api('/api/idle/start', {
      method: 'POST',
      body: JSON.stringify(body),
    })
      .then((result) => {
        if (!result) return;

        setIdlingUI(true, result.since, result.appIds, result.stopAt);

        if (result.appIds?.[0] !== undefined) {
          onActiveGame(result.appIds[0]);
        }
      })
      .catch((err) => {
        if (err.code === 'session_expired') {
          onUnauthorized();
          return;
        }

        idleError.textContent = err.message;
        setIdlingUI(false, null, null, null);
        onActiveGame(null);
        setStatus('offline');
      })
      .finally(() => {
        idling = false;
      });
  }

  async function refreshStatus() {
    try {
      const result = await api('/api/idle/status');
      const view = idleView(result, { wasIdling });

      setStatus(view.mode);
      if (view.notice) idleError.textContent = view.notice;

      if (view.showIdle) {
        setIdlingUI(true, view.since, result.appIds, view.stopAt);

        if (view.gameId !== null) {
          onActiveGame(view.gameId);
        }
      } else {
        setIdlingUI(false, null, null, null);
        onActiveGame(null);
      }

      wasIdling = view.showIdle;
    } catch (err) {
      if (err.code === 'session_expired') {
        onUnauthorized();
        return;
      }

      idleError.textContent = err.message;
      setStatus('offline');
    }
  }

  function restoreDuration(prefs = {}) {
    const duration = prefs.duration || 0;
    selectedDuration = duration;

    durationPresets.querySelectorAll('.preset').forEach((preset) => {
      setPressed(preset, Number(preset.dataset.duration) === duration);
    });
  }

  function applyPrefs(prefs = {}) {
    if (!personaTouched) {
      personaToggle.checked = prefs.appearOnline !== false;
    }

    restoreDuration(prefs);
  }

  async function stopIdle() {
    idleError.textContent = '';
    wasIdling = false;

    try {
      await api('/api/idle/stop', { method: 'POST' });
    } catch (err) {
      if (err.code === 'session_expired') {
        onUnauthorized();
        return;
      }

      idleError.textContent = err.message;
      return;
    }

    setIdlingUI(false, null, null, null);
    await refreshStatus();
  }

  durationPresets.addEventListener('click', (event) => {
    const button = event.target.closest('.preset');
    if (!button) return;

    durationPresets.querySelectorAll('.preset').forEach((preset) => {
      setPressed(preset, preset === button);
    });

    selectedDuration = Number(button.dataset.duration) || 0;

    api('/api/idle/prefs', {
      method: 'POST',
      body: JSON.stringify({ duration: selectedDuration }),
    }).catch(() => {});
  });

  personaToggle.addEventListener('change', () => {
    personaTouched = true;

    api('/api/idle/prefs', {
      method: 'POST',
      body: JSON.stringify({ appearOnline: personaToggle.checked }),
    }).catch(() => {});
  });

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping…';

    try {
      await stopIdle();
    } finally {
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop';
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (!window.confirm("Disconnect from Steam? You'll need to scan the QR code again.")) {
      return;
    }

    disconnectBtn.disabled = true;

    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // The local UI is reset even if the request failed.
    }

    clearInterval(tickHandle);
    tickHandle = null;
    wasIdling = false;
    idling = false;
    disconnectBtn.disabled = false;
    onUnauthorized();
  });

  return { idleGame, stopIdle, refreshStatus, reset, applyPrefs };
}
