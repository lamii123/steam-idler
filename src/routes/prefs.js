const express = require('express');

const store = require('../db/store');
const { requireSession } = require('../middleware/session');
const { parseIdlePrefs } = require('../lib/idleRequest');
const { clientError } = require('../lib/clientError');

function createPrefsRoutes({ idleSessions }) {
  const router = express.Router();
  router.use(requireSession);

  router.get('/', (req, res) => {
    const prefs = store.getIdlePrefs(req.steamSession.sessionId);
    res.json(prefs || store.DEFAULT_IDLE_PREFS);
  });

  router.post('/', (req, res) => {
    const parsed = parseIdlePrefs(req.body || {});
    if (!parsed.ok) throw clientError('invalidRequest', parsed.error);

    const { sessionId, steamId } = req.steamSession;
    const updated = {
      ...(store.getIdlePrefs(sessionId) || store.DEFAULT_IDLE_PREFS),
      ...parsed.value,
    };

    store.setIdlePrefs(sessionId, updated);

    if (parsed.value.appearOnline !== undefined) {
      idleSessions.setPersona(steamId, updated.appearOnline);
    }

    res.json(updated);
  });

  return router;
}

module.exports = { createPrefsRoutes };
