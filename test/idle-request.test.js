const { test } = require('node:test');
const assert = require('node:assert');

if (!process.env.PORT || process.env.PORT === '0') process.env.PORT = '3000';
process.env.SESSION_ENC_KEY = '1'.repeat(64);
process.env.COOKIE_SECRET = 'idle-request-test-secret';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { parseIdleStart, parseIdlePrefs } = require('../src/lib/idleRequest');

test('start: defaults to unlimited and online, deduplicating app ids', () => {
  const result = parseIdleStart({ appIds: [730, '730', 440] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    appIds: [730, 440],
    duration: 0,
    appearOnline: true,
  });
});

test('start: rejects an oversized app list instead of truncating it', () => {
  const result = parseIdleStart({
    appIds: Array.from({ length: 33 }, (_, index) => index + 1),
  });

  assert.equal(result.ok, false);
  assert.equal(result.field, 'appIds');
  assert.match(result.error, /maximum of 32/i);
});

test('start: rejects a non-array or empty app list', () => {
  for (const appIds of [undefined, '730', [], ['nope', -1]]) {
    const result = parseIdleStart({ appIds });
    assert.equal(result.ok, false);
    assert.equal(result.field, 'appIds');
  }
});

test('start: duration must be a known preset', () => {
  const result = parseIdleStart({ appIds: [730], duration: 1234 });

  assert.equal(result.ok, false);
  assert.equal(result.field, 'duration');
  assert.equal(result.error, 'Invalid duration');
});

test('start: appearOnline must be a boolean', () => {
  const result = parseIdleStart({ appIds: [730], appearOnline: 'yes' });

  assert.equal(result.ok, false);
  assert.equal(result.field, 'appearOnline');
});

test('prefs: accepts a partial update with the duration name', () => {
  assert.deepEqual(parseIdlePrefs({ duration: 1800000 }), {
    ok: true,
    value: { duration: 1800000 },
  });
  assert.deepEqual(parseIdlePrefs({ appearOnline: false }), {
    ok: true,
    value: { appearOnline: false },
  });
});

test('prefs: rejects the old name and empty updates', () => {
  for (const body of [{ selectedDuration: 1800000 }, {}]) {
    const result = parseIdlePrefs(body);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'No supported preference fields were provided');
  }
});
