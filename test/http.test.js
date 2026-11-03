const { after, before, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter, once } = require('events');
const nodeCrypto = require('crypto');

// config.js rejects PORT=0 (some shells export it); the server below binds an
// ephemeral port of its own.
if (!process.env.PORT || process.env.PORT === '0') process.env.PORT = '3000';

process.env.SESSION_ENC_KEY = '6'.repeat(64);
process.env.COOKIE_SECRET = 'http-test-secret';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-http-test-'));

const store = require('../src/db/store');
const crypto = require('../src/lib/crypto');
const { createIdleSessions } = require('../src/steam/idleSessions');
const { createConnectAccount } = require('../src/auth/connectAccount');
const { createLibrary } = require('../src/steam/library');
const { createApp } = require('../src/app');

const STEAM_ID = '76561190000000030';
const EXPLODE_ID = '76561190000000031';

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

  logOn(options = {}) {
    if (options.refreshToken === 'explode-token') {
      queueMicrotask(() => this.emit('error', new Error('startHeartbeat is not defined')));
      return;
    }

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

const idleSessions = createIdleSessions({ SteamUser: FakeSteamUser });
const accounts = createConnectAccount({ idleSessions });
const library = createLibrary({ idle: idleSessions });

let server;
let base;
const sessions = new Map();

function createSession(steamId, refreshToken) {
  const sessionId = crypto.randomId(32);
  store.create(steamId, crypto.encrypt(refreshToken), sessionId, 'user', 'qr');
  sessions.set(steamId, sessionId);
  return sessionId;
}

function cookieFor(sessionId) {
  // Same format cookie-parser expects for a signed `s:<value>.<hmac>` cookie.
  const signature = nodeCrypto
    .createHmac('sha256', process.env.COOKIE_SECRET)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');

  return `sid=${encodeURIComponent(`s:${sessionId}.${signature}`)}`;
}

function apiFetch(steamId, pathname, options = {}) {
  return fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      Cookie: cookieFor(sessions.get(steamId)),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method === 'POST' ? { Origin: base } : {}),
      ...(options.headers || {}),
    },
  });
}

before(async () => {
  store.init();
  createSession(STEAM_ID, 'refresh-token');
  createSession(EXPLODE_ID, 'explode-token');

  server = createApp({ idleSessions, accounts, library }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  idleSessions.shutdownAll();
  server.close();
  await store.flush().catch(() => {});
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('health endpoint reports the package version', async () => {
  const res = await fetch(`${base}/health`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
});

test('static index and security headers are served', async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  const csp = res.headers.get('content-security-policy');

  assert.equal(res.status, 200);
  assert.match(html, /<title>Steam Idle<\/title>/);
  assert.match(html, /rel="icon"[^>]+href="\/favicon\.png"/);
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /style-src[^;]*'unsafe-inline'/);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('favicon is served as a small PNG', async () => {
  const res = await fetch(`${base}/favicon.png`);
  const bytes = await res.arrayBuffer();

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/png/);
  assert.ok(bytes.byteLength < 50_000, `favicon is ${bytes.byteLength} bytes`);
});

test('API responses are not cached and report a logged-out session', async () => {
  const res = await fetch(`${base}/api/auth/me`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { connected: false });
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('protected APIs identify an expired session', async () => {
  const res = await fetch(`${base}/api/idle/status`);
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.equal(body.code, 'session_expired');
});

test('state-changing requests without an Origin are rejected', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  const body = await res.json();

  assert.equal(res.status, 403);
  assert.match(body.error, /Origin|Referer/i);
});

test('cross-origin state-changing requests are rejected', async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  });

  assert.equal(res.status, 403);
});

test('a different port on the same host counts as cross-origin', async () => {
  const port = server.address().port;
  const otherPort = port === 65535 ? 65534 : port + 1;
  const res = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${otherPort}` },
  });

  assert.equal(res.status, 403);
});

test('same-origin logout succeeds without a session', async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: base },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('invalid password payloads are rejected before contacting Steam', async () => {
  const res = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountName: '', password: '' }),
  });

  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'invalidRequest');
});

test('malformed JSON and oversized bodies map to client errors', async () => {
  const malformed = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(malformed.status, 400);

  const oversized = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountName: 'a'.repeat(20_000), password: 'x' }),
  });
  assert.equal(oversized.status, 413);
});

test('unknown API and page routes return 404', async () => {
  const api = await fetch(`${base}/api/does-not-exist`);
  assert.equal(api.status, 404);
  assert.deepEqual(await api.json(), { error: 'Not found', code: 'notFound' });

  const page = await fetch(`${base}/does-not-exist`);
  assert.equal(page.status, 404);

  const bareApi = await fetch(`${base}/api`);
  assert.equal(bareApi.status, 404);
  assert.deepEqual(await bareApi.json(), { error: 'Not found', code: 'notFound' });
});

test('authenticated idle start drives the injected client', async () => {
  const res = await apiFetch(STEAM_ID, '/api/idle/start', {
    method: 'POST',
    body: JSON.stringify({ appIds: [730, 730, '440'], duration: 1800000 }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.idling, true);
  assert.deepEqual(body.appIds, [730, 440]);
  assert.equal(FakeSteamUser.instances.length, 1);
  assert.deepEqual(FakeSteamUser.instances[0].games, [730, 440]);

  const statusRes = await apiFetch(STEAM_ID, '/api/idle/status');
  const status = await statusRes.json();

  assert.equal(statusRes.status, 200);
  assert.equal(status.idling, true);
  assert.equal(status.connected, true);
});

test('an oversized app list is rejected, not silently truncated', async () => {
  const appIds = Array.from({ length: 33 }, (_, index) => index + 1);
  const res = await apiFetch(STEAM_ID, '/api/idle/start', {
    method: 'POST',
    body: JSON.stringify({ appIds }),
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.code, 'invalidRequest');
  assert.match(body.error, /maximum of 32/i);
});

test('an invalid duration uses the shared parse and error contract', async () => {
  const res = await apiFetch(STEAM_ID, '/api/idle/start', {
    method: 'POST',
    body: JSON.stringify({ appIds: [730], duration: 1234 }),
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.code, 'invalidRequest');
  assert.equal(body.error, 'Invalid duration');
});

test('unknown idle failures become a generic 502, never an echoed message', async () => {
  const res = await apiFetch(EXPLODE_ID, '/api/idle/start', {
    method: 'POST',
    body: JSON.stringify({ appIds: [730] }),
  });
  const body = await res.json();

  assert.equal(res.status, 502);
  assert.equal(body.code, 'steamUnavailable');
  assert.doesNotMatch(body.error, /startHeartbeat/);
});

test('idle preferences use the single duration field', async () => {
  const update = await apiFetch(STEAM_ID, '/api/idle/prefs', {
    method: 'POST',
    body: JSON.stringify({ duration: 3600000, appearOnline: false }),
  });
  const updated = await update.json();

  assert.equal(update.status, 200);
  assert.equal(updated.duration, 3600000);
  assert.equal(updated.appearOnline, false);

  const read = await apiFetch(STEAM_ID, '/api/idle/prefs');
  const prefs = await read.json();
  assert.equal(prefs.duration, 3600000);

  const legacy = await apiFetch(STEAM_ID, '/api/idle/prefs', {
    method: 'POST',
    body: JSON.stringify({ selectedDuration: 1800000 }),
  });

  assert.equal(legacy.status, 400);
  assert.equal((await legacy.json()).code, 'invalidRequest');
});
