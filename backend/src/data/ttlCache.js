'use strict';
// Tiny in-memory cache with an expiry, shared by the AWS stores so new data shows up without a restart.

class TtlCache {
  constructor(ttlMs = 5 * 60 * 1000, now = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  // Returns the cached value (null counts as a value), or loads, stores and returns it.
  async get(key, load) {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = await load();
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    return value;
  }
}

module.exports = { TtlCache };
