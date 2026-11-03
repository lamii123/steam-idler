const SteamUser = require('steam-user');

const config = require('../config');
const logger = require('../lib/logger');
const { validateAppIds: sharedValidate } = require('../lib/validateAppIds');

const HEARTBEAT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RESUME_CONCURRENCY = 3;
const PLAYING_STATE_CHECK_MS = 2_000;

/**
 * One Steam client per Steam ID. Heartbeat, auto-stop, reconnect and
 * restart-resume all live behind this interface, so the unbound-call and
 * missing-start failures of the old split modules cannot recur.
 *
 * `SteamUser` is injectable so tests can drive a fake client instead of
 * opening a socket.
 */
function createIdleSessions({ SteamUser: SteamUserClass = SteamUser, logger: log = logger } = {}) {
  const clients = new Map();
  const lastStops = new Map();
  let shuttingDown = false;

  function isExpiredStopAt(value, now = Date.now()) {
    const stopAt = Number(value);
    return Number.isFinite(stopAt) && stopAt > 0 && stopAt <= now;
  }

  function taggedError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  function validateAppIds(appIds) {
    if (!Array.isArray(appIds)) {
      throw taggedError('invalidRequest', 'appIds must be an array');
    }

    const cleaned = sharedValidate(appIds);

    if (cleaned.length === 0) {
      throw taggedError('invalidRequest', 'At least one valid, positive numeric appId is required');
    }
    if (cleaned.length > config.maxAppIdsPerSession) {
      throw taggedError(
        'invalidRequest',
        `A maximum of ${config.maxAppIdsPerSession} appIds can be idled at once`
      );
    }

    return cleaned;
  }

  function describe(entry, reason) {
    if (!entry) {
      return {
        idling: false,
        connected: false,
        connecting: false,
        reconnecting: false,
        ...(reason ? { reason } : {}),
      };
    }

    const idling = entry.status === 'online' && entry.idling !== false;

    return {
      idling,
      connected: true,
      connecting: entry.status === 'connecting',
      reconnecting: entry.status === 'connecting' && entry.reconnectAttempts > 0,
      appIds: entry.appIds,
      since: entry.since,
      stopAt: entry.stopAt,
      ...(reason && !idling ? { reason } : {}),
    };
  }

  function startHeartbeat(entry) {
    stopHeartbeat(entry);
    entry.heartbeat = setInterval(() => {
      try {
        entry.client.gamesPlayed(entry.appIds);
      } catch {
        // A closing socket can throw here; the disconnect handler takes over.
      }
    }, HEARTBEAT_MS);

    if (typeof entry.heartbeat.unref === 'function') entry.heartbeat.unref();
  }

  function stopHeartbeat(entry) {
    if (entry.heartbeat) {
      clearInterval(entry.heartbeat);
      entry.heartbeat = null;
    }
  }

  function clearAutoStop(entry) {
    if (entry.autoStopTimer) {
      clearTimeout(entry.autoStopTimer);
      entry.autoStopTimer = null;
    }
  }

  function scheduleAutoStop(steamId, entry) {
    clearAutoStop(entry);
    if (!entry.stopAt) return;

    const delay = entry.stopAt - Date.now();
    if (delay <= 0) {
      performAutoStop(steamId, entry);
      return;
    }

    entry.autoStopTimer = setTimeout(() => performAutoStop(steamId, entry), delay);
    if (typeof entry.autoStopTimer.unref === 'function') entry.autoStopTimer.unref();
  }

  function performAutoStop(steamId, entry) {
    if (clients.get(steamId) !== entry) return;

    log.info('auto-stopping idle session', { steamId });
    lastStops.set(steamId, 'autoStopped');
    cleanupEntry(entry);
    entry.client.removeAllListeners();
    try {
      entry.client.logOff();
    } catch {
      // Ignore a socket that is already gone.
    }

    clients.delete(steamId);

    if (entry.onAutoStop) entry.onAutoStop();
  }

  function clearReconnect(entry) {
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  }

  function removePlayingStateListener(entry) {
    if (entry.playingStateHandler && entry.client) {
      try {
        entry.client.removeListener('playingState', entry.playingStateHandler);
      } catch {
        // Ignore.
      }
      entry.playingStateHandler = null;
    }
  }

  function cleanupEntry(entry) {
    stopHeartbeat(entry);
    clearAutoStop(entry);
    clearReconnect(entry);
    removePlayingStateListener(entry);
  }

  function checkPlayingState(client, appIds) {
    return new Promise((resolve) => {
      if (client.playingState && client.playingState.blocked) {
        resolve(true);
        return;
      }

      let settled = false;
      const finish = (blocked) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.removeListener('playingState', handler);
        resolve(blocked);
      };

      const handler = (blocked) => {
        finish(Boolean(blocked));
      };

      const timer = setTimeout(() => {
        finish(false);
      }, PLAYING_STATE_CHECK_MS);

      if (typeof timer.unref === 'function') timer.unref();

      client.on('playingState', handler);
      try {
        client.gamesPlayed(appIds);
      } catch {
        // Ignore; the timeout above settles the check.
      }
    });
  }

  function createPlayingStateHandler(steamId, entry) {
    return (blocked) => {
      if (!blocked) return;
      if (clients.get(steamId) !== entry) return;
      if (entry.status !== 'online') return;

      log.info('session blocked by another Steam client playing a game', { steamId });
      stopHeartbeat(entry);
      clearAutoStop(entry);
      entry.status = 'online';
      entry.idling = false;
      entry.appIds = [];
      entry.stopAt = null;
      lastStops.set(steamId, 'playingElsewhere');

      if (entry.onPlayingBlocked) entry.onPlayingBlocked();
    };
  }

  function start(steamId, refreshToken, appIds, options = {}) {
    if (typeof refreshToken !== 'string' || !refreshToken) {
      return Promise.reject(taggedError('invalidRequest', 'A Steam refresh token is required'));
    }

    const cleanAppIds = validateAppIds(appIds);
    lastStops.delete(steamId);
    const {
      stopAt = null,
      appearOnline = true,
      onDisconnect = null,
      onAutoStop = null,
      onPlayingBlocked = null,
    } = options;

    const existing = clients.get(steamId);

    if (existing && existing.status === 'online') {
      existing.appIds = cleanAppIds;
      existing.stopAt = stopAt;
      existing.appearOnline = appearOnline;
      existing.idling = true;
      startHeartbeat(existing);
      scheduleAutoStop(steamId, existing);
      try {
        existing.client.gamesPlayed(cleanAppIds);
      } catch {
        // Ignore.
      }
      existing.client.setPersona(
        appearOnline ? SteamUserClass.EPersonaState.Online : SteamUserClass.EPersonaState.Offline
      );
      return Promise.resolve({
        steamId,
        appIds: cleanAppIds,
        since: existing.since,
        stopAt: existing.stopAt,
      });
    }

    if (existing && existing.status === 'connecting') {
      return Promise.reject(
        taggedError('connectionInProgress', 'A connection attempt is already in progress')
      );
    }

    return new Promise((resolve, reject) => {
      const client = new SteamUserClass({ enablePicsCache: true });
      const entry = {
        client,
        appIds: cleanAppIds,
        since: Date.now(),
        status: 'connecting',
        idling: false,
        heartbeat: null,
        stopAt,
        appearOnline,
        autoStopTimer: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
        onDisconnect,
        onAutoStop,
        onPlayingBlocked,
        playingStateHandler: null,
        initialLogonDone: false,
      };

      clients.set(steamId, entry);

      const failConnecting = (err) => {
        if (entry.status !== 'connecting') return;
        entry.status = 'errored';
        if (!err.code) err.code = 'steamUnavailable';
        cleanupEntry(entry);
        clients.delete(steamId);
        try {
          client.logOff();
        } catch {
          // Ignore.
        }
        reject(err);
      };

      const onError = (err) => {
        if (entry.status === 'connecting') {
          failConnecting(err);
        } else {
          log.warn('Steam client error while connected', { steamId, message: err.message });
        }
      };

      client.on('error', onError);

      const timeout = setTimeout(() => {
        failConnecting(new Error('Steam connection timed out'));
      }, CONNECT_TIMEOUT_MS);
      if (typeof timeout.unref === 'function') timeout.unref();

      const attemptReconnect = () => {
        if (clients.get(steamId) !== entry || shuttingDown) return;

        if (entry.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          log.error('giving up on Steam reconnect', {
            steamId,
            attempts: MAX_RECONNECT_ATTEMPTS,
          });
          entry.status = 'offline';
          cleanupEntry(entry);
          clients.delete(steamId);
          return;
        }

        entry.reconnectAttempts += 1;
        const delay = Math.min(1000 * 2 ** (entry.reconnectAttempts - 1), 30_000);

        log.info('reconnecting to Steam', {
          steamId,
          attempt: entry.reconnectAttempts,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
          delayMs: delay,
        });

        entry.reconnectTimer = setTimeout(() => {
          entry.reconnectTimer = null;
          if (clients.get(steamId) !== entry || shuttingDown) return;

          entry.status = 'connecting';
          try {
            client.logOn({ refreshToken });
          } catch {
            entry.status = 'offline';
            cleanupEntry(entry);
            clients.delete(steamId);
          }
        }, delay);

        if (typeof entry.reconnectTimer.unref === 'function') entry.reconnectTimer.unref();
      };

      client.on('disconnected', (eresult) => {
        if (clients.get(steamId) !== entry) return;
        cleanupEntry(entry);

        if (shuttingDown) return;

        if (eresult === 5 || eresult === 'LoggedInElsewhere') {
          log.info('session displaced by another Steam client', { steamId });
          clients.delete(steamId);
          if (entry.onDisconnect) entry.onDisconnect();
          return;
        }

        log.warn('Steam client disconnected', { steamId, eresult });
        entry.status = 'connecting';
        attemptReconnect();
      });

      client.on('loggedOn', async () => {
        try {
          if (clients.get(steamId) !== entry) return;

          clearTimeout(timeout);

          if (!entry.initialLogonDone) {
            entry.initialLogonDone = true;

            const blocked = await checkPlayingState(client, cleanAppIds);

            if (blocked) {
              entry.status = 'errored';
              cleanupEntry(entry);
              clients.delete(steamId);
              try {
                client.logOff();
              } catch {
                // Ignore.
              }
              reject(
                taggedError(
                  'playingElsewhere',
                  'Another Steam session is already playing a game. Stop playing on your other client first.'
                )
              );
              return;
            }

            resolve({
              steamId,
              appIds: entry.appIds,
              since: entry.since,
              stopAt: entry.stopAt,
            });
          }

          entry.reconnectAttempts = 0;
          entry.status = 'online';
          entry.idling = true;
          try {
            client.gamesPlayed(entry.appIds);
          } catch {
            // Ignore.
          }
          client.setPersona(
            entry.appearOnline
              ? SteamUserClass.EPersonaState.Online
              : SteamUserClass.EPersonaState.Offline
          );
          startHeartbeat(entry);
          scheduleAutoStop(steamId, entry);

          if (!entry.playingStateHandler) {
            entry.playingStateHandler = createPlayingStateHandler(steamId, entry);
            client.on('playingState', entry.playingStateHandler);
          }

          log.debug('Steam client online', {
            steamId,
            games: entry.appIds.length,
          });
        } catch (err) {
          log.error('loggedOn handler failed', { steamId, message: err.message });
          failConnecting(err);
        }
      });

      try {
        client.logOn({ refreshToken });
      } catch (err) {
        failConnecting(err);
      }
    });
  }

  function stop(steamId) {
    lastStops.delete(steamId);
    const entry = clients.get(steamId);
    if (!entry) return;

    entry.onDisconnect = null;
    entry.onAutoStop = null;
    entry.onPlayingBlocked = null;
    cleanupEntry(entry);
    entry.client.removeAllListeners();

    try {
      entry.client.logOff();
    } finally {
      clients.delete(steamId);
    }
  }

  function status(steamId) {
    return describe(clients.get(steamId), lastStops.get(steamId));
  }

  function ownedClient(steamId) {
    const entry = clients.get(steamId);
    if (!entry || entry.status !== 'online') return null;
    return entry.client;
  }

  function setPersona(steamId, appearOnline) {
    const entry = clients.get(steamId);
    if (!entry || entry.status !== 'online') return;

    entry.appearOnline = appearOnline;
    entry.client.setPersona(
      appearOnline ? SteamUserClass.EPersonaState.Online : SteamUserClass.EPersonaState.Offline
    );
  }

  /**
   * Resume persisted sessions after a restart. Defaults to this module's own
   * `start`; `now` and `start` remain injectable for tests.
   */
  async function resumeAll(sessions, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const startFn = typeof options.start === 'function' ? options.start : start;
    const queue = [...sessions];

    const worker = async () => {
      while (queue.length > 0) {
        const session = queue.shift();
        if (!session.lastAppIds || session.lastAppIds.length === 0) continue;

        if (isExpiredStopAt(session.stopAt, now)) {
          log.info('skipping expired idle session', { steamId: session.steamId });

          if (typeof session.onExpired === 'function') {
            try {
              session.onExpired(session);
            } catch (err) {
              log.warn('could not clear expired idle session', {
                steamId: session.steamId,
                message: err.message,
              });
            }
          }
          continue;
        }

        try {
          const rawStopAt = Number(session.stopAt);
          const stopAt = Number.isFinite(rawStopAt) && rawStopAt > now ? rawStopAt : null;
          const appearOnline = session.idlePrefs?.appearOnline !== false;

          await startFn(session.steamId, session.refreshToken, session.lastAppIds, {
            stopAt,
            appearOnline,
            onDisconnect:
              typeof session.onDisconnect === 'function' ? session.onDisconnect : null,
            onAutoStop: typeof session.onAutoStop === 'function' ? session.onAutoStop : null,
            onPlayingBlocked:
              typeof session.onPlayingBlocked === 'function' ? session.onPlayingBlocked : null,
          });
          log.info('resumed idle session', { steamId: session.steamId });
        } catch (err) {
          log.warn('could not resume idle session', {
            steamId: session.steamId,
            message: err.message,
          });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(RESUME_CONCURRENCY, queue.length) },
      () => worker()
    );

    await Promise.all(workers);
  }

  function shutdownAll() {
    shuttingDown = true;

    for (const steamId of [...clients.keys()]) {
      stop(steamId);
    }
  }

  return {
    start,
    stop,
    status,
    setPersona,
    ownedClient,
    resumeAll,
    shutdownAll,
  };
}

module.exports = { createIdleSessions };
