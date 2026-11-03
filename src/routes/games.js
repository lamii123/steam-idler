const express = require('express');

const { requireSession } = require('../middleware/session');
const { getGameDetails } = require('../steam/steamApi');
const { clientError } = require('../lib/clientError');

const EMPTY_DETAILS = Object.freeze({ description: '', genres: [], categories: [] });

function createGamesRoutes() {
  const router = express.Router();
  router.use(requireSession);

  router.get('/:appId/details', async (req, res) => {
    const appId = Number(req.params.appId);

    if (!Number.isInteger(appId) || appId <= 0 || appId > 0xffffffff) {
      throw clientError('invalidRequest', 'Invalid appId');
    }

    // Game details are optional decoration: the adapter already turns a Steam
    // failure into null, so this route has no catch-and-swallow branch.
    const details = await getGameDetails(appId);
    res.json(details || EMPTY_DETAILS);
  });

  return router;
}

module.exports = { createGamesRoutes };
