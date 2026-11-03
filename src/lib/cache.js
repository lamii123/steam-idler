/**
 * Small in-memory LRU cache with a TTL and single-flight de-duplication.
 * No external dependency; entries are evicted on read and on insert.
 */
class TtlCache {
  constructor({ ttlMs, maxEntries = 500, now = Date.now } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('TtlCache requires a positive ttlMs');
    }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
    this.pending = new Map();
  }

  _isExpired(entry) {
    return entry.expiresAt <= this.now();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (this._isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh insertion order so the least recently used key is evicted first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }

    return value;
  }

  delete(key) {
    this.entries.delete(key);
    this.pending.delete(key);
  }

  clear() {
    this.entries.clear();
    this.pending.clear();
  }

  get size() {
    return this.entries.size;
  }

  /**
   * Return a cached value or run `loader`, sharing one in-flight promise with
   * concurrent callers for the same key. Rejected loads are not cached.
   */
  async wrap(key, loader) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    if (this.pending.has(key)) return this.pending.get(key);

    const task = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (value !== undefined && value !== null) this.set(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, task);
    return task;
  }
}

module.exports = { TtlCache };
