const express = require('express');

const { createAuthRoutes } = require('./auth');
const { createIdleRoutes } = require('./idle');
const { createPrefsRoutes } = require('./prefs');
const { createProfileRoutes } = require('./profile');
const { createGamesRoutes } = require('./games');

function createRouter({ idleSessions, accounts, library }) {
  const router = express.Router();

  router.use('/auth', createAuthRoutes({ idleSessions, accounts }));

  // Mount the more specific path first so /idle/prefs never runs the idle
  // router's generic session middleware twice.
  router.use('/idle/prefs', createPrefsRoutes({ idleSessions }));
  router.use('/idle', createIdleRoutes({ idleSessions }));

  router.use('/profile', createProfileRoutes({ idleSessions, library }));
  router.use('/games', createGamesRoutes());

  return router;
}

module.exports = { createRouter };
