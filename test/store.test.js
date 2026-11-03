// Security and data-layer regression checks: node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SESSION_ENC_KEY = '5'.repeat(64); // dummy 32-byte hex key for tests
process.env.COOKIE_SECRET = 'test-secret';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-test-'));
if (!process.env.PORT || process.env.PORT === '0') process.env.PORT = '3000';

const crypto = require('../src/lib/crypto');
const store = require('../src/db/store');
const { createConnectAccount } = require('../src/auth/connectAccount');

const connectAccount = createConnectAccount({ idleSessions: { stop() {} } }).connectAccount;

test('crypto: refresh-token blob round-trips', () => {
  const blob = crypto.encrypt('refresh-token');
  assert.match(blob, /^v1\./);
  assert.equal(crypto.decrypt(blob), 'refresh-token');
});

test('crypto: tampered ciphertext is rejected', () => {
  const blob = crypto.encrypt('refresh-token');
  const bytes = Buffer.from(blob.slice(3), 'base64');
  bytes[bytes.length - 1] ^= 0xff;

  assert.throws(() => crypto.decrypt(`v1.${bytes.toString('base64')}`));
  assert.throws(() => crypto.decrypt(''));
});

test('session lifecycle: create -> get -> destroy', () => {
  store.init();
  store.create('76561190000000000', crypto.encrypt('tok'), 'sess1', 'user', 'qr');
  assert.equal(store.get('sess1').steamId, '76561190000000000');
  store.destroy('sess1');
  assert.equal(store.get('sess1'), null);
});

test('idle prefs: forged keys are dropped, only allowlisted fields survive', () => {
  store.create('76561190000000001', 'x', 'sess2', 'user2', 'qr');
  store.setIdlePrefs('sess2', {
    appearOnline: false,
    duration: 3600000,
    isAdmin: true,
    __proto__: { polluted: true },
    steamId: 'attacker',
    refreshToken: 'leak-attempt',
  });
  const prefs = store.getIdlePrefs('sess2');
  assert.deepEqual(Object.keys(prefs).sort(), ['appearOnline', 'duration']);
  assert.equal(prefs.isAdmin, undefined);
  assert.equal({}.polluted, undefined); // no prototype pollution
});

test('idle prefs: non-integer / negative duration no-ops (keeps prior value)', () => {
  store.create('76561190000000003', 'x', 'sess3', 'user3', 'qr');
  store.setIdlePrefs('sess3', { duration: 0 });
  store.setIdlePrefs('sess3', { duration: -5 });
  assert.equal(store.getIdlePrefs('sess3').duration, 0); // rejected, unchanged
  store.setIdlePrefs('sess3', { duration: 1.5 });
  assert.equal(store.getIdlePrefs('sess3').duration, 0); // rejected, unchanged
  store.setIdlePrefs('sess3', { duration: '1800000' });
  assert.equal(store.getIdlePrefs('sess3').duration, 1800000); // numeric string OK
});

test('idle prefs: unknown duration presets are rejected', () => {
  store.create('76561190000000004', 'x', 'sess4', 'user4', 'qr');
  store.setIdlePrefs('sess4', { duration: 1234 });
  assert.equal(store.getIdlePrefs('sess4').duration, 0);
});

test('idle prefs: the legacy selectedDuration key migrates to duration', () => {
  store.create('76561190000000007', 'x', 'sess7', 'user7', 'qr');
  store.setIdlePrefs('sess7', {});

  const record = store.get('sess7');
  record.idlePrefs = { appearOnline: false, selectedDuration: 3600000 };
  const prefs = store.getIdlePrefs('sess7');

  assert.equal(prefs.duration, 3600000);
  assert.equal(prefs.appearOnline, false);
  assert.equal(prefs.selectedDuration, undefined);
});

test('one session per steam account: connectAccount displaces the old one', () => {
  const first = connectAccount({
    steamId: '76561190000000002',
    refreshToken: 'token-a',
    accountName: 'u',
    type: 'qr',
  });
  const second = connectAccount({
    steamId: '76561190000000002',
    refreshToken: 'token-b',
    accountName: 'u',
    type: 'qr',
  });

  assert.equal(store.get(first.sessionId), null);
  assert.notEqual(store.get(second.sessionId), null);
});

test('profile cache: stored in memory and dropped with the session', () => {
  store.create('76561190000000005', 'x', 'sess5', 'user5', 'qr');
  store.setCachedProfile('sess5', { profile: { name: 'cached' } });

  assert.equal(store.getCachedProfile('sess5').profile.name, 'cached');

  store.destroy('sess5');
  assert.equal(store.getCachedProfile('sess5'), null);
});

test('persistence: flush writes sessions atomically and survives a reload', async () => {
  store.create('76561190000000006', crypto.encrypt('tok'), 'sess6', 'user6', 'qr');

  await store.flush();

  const file = path.join(process.env.DATA_DIR, 'sessions.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.sess6.steamId, '76561190000000006');
  assert.match(onDisk.sess6.encryptedRefreshToken, /^v1\./);

  store.init();
  assert.equal(store.get('sess6').steamId, '76561190000000006');
});
