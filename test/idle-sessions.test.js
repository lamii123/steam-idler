// Idle session lifecycle: status shape, restart resume, and re-idling.
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

process.env.SESSION_ENC_KEY = '7'.repeat(64);
process.env.COOKIE_SECRET = 'idle-sessions-test-secret';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
if (!process.env.PORT || process.env.PORT === '0') process.env.PORT = '3000';

const { createIdleSessions } = require('../src/steam/idleSessions');

const NOW = 1_700_000_000_000;
const STEAM_ID = '76561190000000010';
const DISCONNECTED = {
  idling: false,
  connected: false,
  connecting: false,
  reconnecting: false,
};

// Only the surface idleSessions uses; no socket is ever opened.
class FakeSteamUser extends EventEmitter {
  static EPersonaState = { Online: 1, Offline: 0 };
  static instances = [];

  constructor() {
    super();
    this.playingState = { blocked: false };
    this.games = null;
    this.persona = null;
    this.loggedOff = false;
    FakeSteamUser.instances.push(this);
  }

  logOn() {
    queueMicrotask(() => this.emit('loggedOn'));
  }

  logOff() {
    this.loggedOff = true;
  }

  gamesPlayed(appIds) {
    this.games = appIds;
    this.emit('playingState', false);
  }

  setPersona(state) {
    this.persona = state;
  }
}

function connect() {
  FakeSteamUser.instances.length = 0;
  return createIdleSessions({ SteamUser: FakeSteamUser });
}

function session(overrides = {}) {
  return {
    sessionId: 'sess-resume',
    steamId: STEAM_ID,
    refreshToken: 'refresh-token',
    lastAppIds: [730],
    idlePrefs: { appearOnline: true },
    stopAt: null,
    ...overrides,
  };
}

test('status of an unknown account is fully disconnected', () => {
  const sessions = connect();

  assert.deepEqual(sessions.status('76561190000000099'), DISCONNECTED);
});

test('status of a connected account is idling', async () => {
  const sessions = connect();

  await sessions.start(STEAM_ID, 'refresh-token', [730]);

  const status = sessions.status(STEAM_ID);
  assert.equal(status.idling, true);
  assert.equal(status.connected, true);
  assert.equal(status.connecting, false);
  assert.equal(status.reconnecting, false);
  assert.deepEqual(status.appIds, [730]);

  sessions.shutdownAll();
});

test('status reports a reconnect in progress', async () => {
  const sessions = connect();

  await sessions.start(STEAM_ID, 'refresh-token', [730]);
  FakeSteamUser.instances[0].emit('disconnected', 1);

  const status = sessions.status(STEAM_ID);
  assert.equal(status.idling, false);
  assert.equal(status.connected, true);
  assert.equal(status.connecting, true);
  assert.equal(status.reconnecting, true);

  sessions.shutdownAll();
});

test('status carries the reason an idle session stopped', async () => {
  const sessions = connect();

  await sessions.start(STEAM_ID, 'refresh-token', [730]);
  FakeSteamUser.instances[0].emit('playingState', true);

  const status = sessions.status(STEAM_ID);
  assert.equal(status.idling, false);
  assert.equal(status.connected, true);
  assert.equal(status.reason, 'playingElsewhere');

  sessions.shutdownAll();
});

test('stop disconnects the client and clears status', async () => {
  const sessions = connect();

  await sessions.start(STEAM_ID, 'refresh-token', [730]);
  sessions.stop(STEAM_ID);

  assert.equal(FakeSteamUser.instances[0].loggedOff, true);
  assert.deepEqual(sessions.status(STEAM_ID), DISCONNECTED);
});

test('re-idling a connected account updates the apps without a second client', async () => {
  const sessions = connect();

  await sessions.start(STEAM_ID, 'refresh-token', [730]);
  const result = await sessions.start(STEAM_ID, 'refresh-token', [440]);

  assert.equal(FakeSteamUser.instances.length, 1);
  assert.deepEqual(result.appIds, [440]);
  assert.deepEqual(FakeSteamUser.instances[0].games, [440]);

  sessions.shutdownAll();
});

test('re-idling with a different game list restarts the elapsed timer', async () => {
  const sessions = connect();

  const first = await sessions.start(STEAM_ID, 'refresh-token', [730]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await sessions.start(STEAM_ID, 'refresh-token', [440]);

  assert.ok(second.since > first.since, 'a new game list starts a new timer');
  assert.equal(sessions.status(STEAM_ID).since, second.since);

  const repeat = await sessions.start(STEAM_ID, 'refresh-token', [440]);
  assert.equal(repeat.since, second.since, 'repeating the same list keeps the timer');

  sessions.shutdownAll();
});

test('resumeAll starts sessions with the module start by default', async () => {
  const sessions = connect();

  await sessions.resumeAll([session()]);

  assert.equal(FakeSteamUser.instances.length, 1);
  assert.deepEqual(FakeSteamUser.instances[0].games, [730]);
  assert.equal(sessions.status(STEAM_ID).idling, true);

  sessions.shutdownAll();
});

test('resumeAll skips sessions whose stopAt already passed and clears them', async () => {
  const sessions = connect();
  let started = false;
  const expired = [];

  await sessions.resumeAll(
    [session({ stopAt: NOW - 1_000, onExpired: (s) => expired.push(s.steamId) })],
    {
      now: NOW,
      start: async () => {
        started = true;
      },
    }
  );

  assert.equal(started, false);
  assert.deepEqual(expired, [STEAM_ID]);
});

test('resumeAll resumes a future stopAt and forwards lifecycle callbacks', async () => {
  const sessions = connect();
  const calls = [];
  const onDisconnect = () => {};
  const onAutoStop = () => {};
  const stopAt = NOW + 60_000;

  await sessions.resumeAll(
    [session({ stopAt, idlePrefs: { appearOnline: false }, onDisconnect, onAutoStop })],
    {
      now: NOW,
      start: async (...args) => {
        calls.push(args);
      },
    }
  );

  assert.equal(calls.length, 1);

  const [steamId, refreshToken, appIds, options] = calls[0];
  assert.equal(steamId, STEAM_ID);
  assert.equal(refreshToken, 'refresh-token');
  assert.deepEqual(appIds, [730]);
  assert.equal(options.stopAt, stopAt);
  assert.equal(options.appearOnline, false);
  assert.equal(options.onDisconnect, onDisconnect);
  assert.equal(options.onAutoStop, onAutoStop);
});

test('resumeAll keeps unlimited sessions unlimited', async () => {
  const sessions = connect();

  for (const stopAt of [null, 0]) {
    const calls = [];

    await sessions.resumeAll([session({ stopAt })], {
      now: NOW,
      start: async (...args) => {
        calls.push(args);
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][3].stopAt, null);
  }
});

test('resumeAll ignores sessions with no stored app ids', async () => {
  const sessions = connect();
  let started = false;
  const expired = [];

  await sessions.resumeAll(
    [session({ lastAppIds: [], stopAt: NOW - 1, onExpired: () => expired.push(true) })],
    {
      now: NOW,
      start: async () => {
        started = true;
      },
    }
  );

  assert.equal(started, false);
  assert.deepEqual(expired, []);
});
