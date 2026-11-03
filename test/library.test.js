const { test } = require('node:test');
const assert = require('node:assert');

if (!process.env.PORT || process.env.PORT === '0') process.env.PORT = '3000';
process.env.SESSION_ENC_KEY = '2'.repeat(64);
process.env.COOKIE_SECRET = 'library-test-secret';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { createLibrary } = require('../src/steam/library');

const STEAM_ID = '76561190000000040';
const idle = { status: () => ({ connected: false }), ownedClient: () => null };

function webApi(getOwnedGames) {
  return { getOwnedGames };
}

function sessionApi(getOwnedGamesViaSession) {
  return { getOwnedGamesViaSession };
}

test('library: the Web API path reports known hours and sorts by playtime', async () => {
  const library = createLibrary({
    idle,
    steamApi: webApi(async () => ({
      totalCount: 2,
      totalHours: 5,
      games: [
        { appId: 10, name: 'Alpha', hours: 1, headerImage: 'a', isFree: false },
        { appId: 20, name: 'Beta', hours: 4, headerImage: 'b', isFree: true },
      ],
    })),
    sessionApi: sessionApi(async () => ({ games: [] })),
  });

  const result = await library.games(STEAM_ID, { refreshToken: 'token' });

  assert.equal(result.source, 'web');
  assert.equal(result.totalHours, 5);
  assert.equal(result.totalHoursKnown, true);
  assert.deepEqual(
    result.games.map((game) => game.appId),
    [20, 10]
  );
});

test('library: falls back to the session source and marks hours unknown', async () => {
  let sessionCalls = 0;

  const library = createLibrary({
    idle,
    steamApi: webApi(async () => null),
    sessionApi: sessionApi(async (_steamId, _token, deps) => {
      sessionCalls += 1;
      assert.equal(deps.idle, idle);
      return {
        totalCount: 1,
        totalHours: null,
        games: [{ appId: 30, name: 'Gamma', hours: null, isFree: null }],
      };
    }),
  });

  const result = await library.games(STEAM_ID, { refreshToken: 'token' });

  assert.equal(sessionCalls, 1);
  assert.equal(result.source, 'session');
  assert.equal(result.totalHours, null);
  assert.equal(result.totalHoursKnown, false);
  assert.equal(result.games[0].hours, null);
  assert.equal(result.games[0].isFree, null);
});

test('library: no API key and no refresh token yields an explicit empty source', async () => {
  const library = createLibrary({
    idle,
    steamApi: webApi(async () => null),
    sessionApi: sessionApi(async () => ({ games: [] })),
  });

  const result = await library.games(STEAM_ID);

  assert.equal(result.source, 'none');
  assert.deepEqual(result.games, []);
});

test('library: both sources failing rejects so the route can degrade explicitly', async () => {
  const library = createLibrary({
    idle,
    steamApi: webApi(async () => {
      throw new Error('web down');
    }),
    sessionApi: sessionApi(async () => {
      throw new Error('session down');
    }),
  });

  await assert.rejects(library.games(STEAM_ID, { refreshToken: 'token' }), /session down/);
});

test('library: caches successful results and clears on refresh', async () => {
  let webCalls = 0;

  const library = createLibrary({
    idle,
    steamApi: webApi(async () => {
      webCalls += 1;
      return {
        totalCount: 1,
        totalHours: 1,
        games: [{ appId: 1, name: 'One', hours: 1 }],
      };
    }),
    sessionApi: sessionApi(async () => ({ games: [] })),
  });

  await library.games(STEAM_ID);
  await library.games(STEAM_ID);
  assert.equal(webCalls, 1);

  await library.games(STEAM_ID, { refresh: true });
  assert.equal(webCalls, 2);

  library.clear(STEAM_ID);
  await library.games(STEAM_ID);
  assert.equal(webCalls, 3);
});
