// Regression checks for the session-based game-list fallback.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_ENC_KEY = '9'.repeat(64);
process.env.COOKIE_SECRET = 'steam-user-api-test-secret';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
if (!process.env.PORT || process.env.PORT === '0') process.env.PORT = '3000';

const { getOwnedGamesViaSession } = require('../src/steam/steamUserApi');

test('session game-list fallback refuses to race a connecting idler', async () => {
  await assert.rejects(
    getOwnedGamesViaSession('76561190000000020', 'refresh-token', {
      idle: {
        status: () => ({ connected: true }),
        ownedClient: () => null,
      },
    }),
    /still connecting/
  );
});

test('session game-list adapter requires the injected idler', async () => {
  await assert.rejects(
    getOwnedGamesViaSession('76561190000000020', 'refresh-token'),
    /idle sessions module is required/
  );
});

test('session game-list fallback requires a refresh token', async () => {
  await assert.rejects(
    getOwnedGamesViaSession('76561190000000020', '', {
      idle: {
        status: () => ({ connected: false }),
        ownedClient: () => null,
      },
    }),
    /refresh token is required/
  );
});
