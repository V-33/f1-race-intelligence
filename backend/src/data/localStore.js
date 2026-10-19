'use strict';
// Data store backed by JSON files in data/processed/. Used for local development.
// Any other store (S3, DynamoDB) must expose the same four async methods:
//   listSeasons() -> number[]
//   getSeason(season) -> season object | null
//   getLaps(season, round) -> lap object | null
//   getReport(season) -> validation report | null

const fs = require('node:fs/promises');
const path = require('node:path');

class LocalStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
  }

  async #read(rel) {
    if (this.cache.has(rel)) return this.cache.get(rel);
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.dir, rel), 'utf8'));
      this.cache.set(rel, data);
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async listSeasons() {
    const index = await this.#read('index.json');
    return index?.seasons || [];
  }

  getSeason(season) {
    return this.#read(path.join(String(season), 'season.json'));
  }

  getLaps(season, round) {
    return this.#read(path.join(String(season), 'laps', `${round}.json`));
  }

  getReport(season) {
    return this.#read(path.join(String(season), 'report.json'));
  }
}

module.exports = { LocalStore };
