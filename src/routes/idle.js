const express = require('express');

const store = require('../db/store');
const { requireSession } = require('../middleware/session');
const { parseIdleStart } = require('../lib/idleRequest');
const { clientError } = require('../lib/clientError');
const logger = require('../lib/logger');

function createIdleRoutes({ idleSessions }) {
  const router = express.Router();
  router.use(requireSession);

  router.post('/start', async (req, res) => {
    const parsed = parseIdleStart(req.body || {});
    if (!parsed.ok) throw clientError('invalidRequest', parsed.error);

    const { appIds, duration, appearOnline } = parsed.value;
    const stopAt = duration > 0 ? Date.now() + duration : null;
    const { sessionId, steamId, refreshToken } = req.steamSession;

    try {
      const result = await idleSessions.start(steamId, refreshToken, appIds, {
        stopAt,
        appearOnline,
        onDisconnect: () => store.destroy(sessionId),
        onAutoStop: () => store.setLastIdle(sessionId, [], null),
        onPlayingBlocked: () => store.setLastIdle(sessionId, [], null),
      });

      store.setLastIdle(sessionId, result.appIds, stopAt);
      res.json({ idling: true, ...result });
    } catch (err) {
      if (err.code === 'invalidRequest') throw clientError('invalidRequest', err.message);
      if (err.code === 'connectionInProgress' || err.code === 'playingElsewhere') {
        throw clientError('conflict', err.message);
      }

      // Unknown upstream failures are logged, never echoed to the browser.
      logger.warn('idle start failed', { steamId, message: err.message });
      throw clientError('steamUnavailable', 'Could not connect to Steam. Try again in a moment.');
    }
  });

  router.post('/stop', (req, res) => {
    const { sessionId, steamId } = req.steamSession;

    idleSessions.stop(steamId);
    store.setLastIdle(sessionId, [], null);
    res.json({ idling: false });
  });

  router.get('/status', (req, res) => {
    res.json(idleSessions.status(req.steamSession.steamId));
  });

  return router;
}

module.exports = { createIdleRoutes };
