const { test } = require('node:test');
const assert = require('node:assert');

const { TtlCache } = require('../src/lib/cache');

function createClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('cache: values expire after the TTL', () => {
  const clock = createClock();
  const cache = new TtlCache({ ttlMs: 100, now: clock.now });

  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);

  clock.advance(99);
  assert.equal(cache.get('a'), 1);

  clock.advance(1);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 0);
});

test('cache: least recently used entry is evicted at capacity', () => {
  const cache = new TtlCache({ ttlMs: 10_000, maxEntries: 2 });

  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // refresh "a", so "b" is now the oldest
  cache.set('c', 3);

  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), 3);
});

test('cache: wrap shares one in-flight load per key', async () => {
  const cache = new TtlCache({ ttlMs: 10_000 });
  let loads = 0;

  const load = () =>
    new Promise((resolve) => {
      loads += 1;
      setImmediate(() => resolve('value'));
    });

  const [first, second] = await Promise.all([cache.wrap('key', load), cache.wrap('key', load)]);

  assert.equal(first, 'value');
  assert.equal(second, 'value');
  assert.equal(loads, 1);
});

test('cache: rejected loads are not cached', async () => {
  const cache = new TtlCache({ ttlMs: 10_000 });
  let attempts = 0;

  const failing = async () => {
    attempts += 1;
    throw new Error('nope');
  };

  await assert.rejects(cache.wrap('key', failing));
  await assert.rejects(cache.wrap('key', failing));
  assert.equal(attempts, 2);
  assert.equal(cache.get('key'), undefined);
});
