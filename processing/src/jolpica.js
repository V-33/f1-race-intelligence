'use strict';
// Minimal client for the Jolpica-F1 API (Ergast-compatible endpoints).
// Terms: free for non-commercial use, data licensed CC BY-NC-SA 4.0.
// Limits (checked Oct 2026): 4 req/s burst, 500 req/hour sustained, max 100 rows per page,
// and a custom User-Agent is required.

const BASE_URL = process.env.JOLPICA_BASE_URL || 'https://api.jolpi.ca/ergast/f1';
const USER_AGENT = 'F1RaceIntelligence/0.1.0 (academic project)';
const PAGE_SIZE = 100;
const MIN_GAP_MS = 350; // keeps us under 4 requests/second

let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, { offset = 0, retries = 4 } = {}) {
  const url = `${BASE_URL}/${path}?limit=${PAGE_SIZE}&offset=${offset}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.ok) return res.json();
    // 429 = throttled, 5xx = server trouble: back off and retry
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** (attempt + 1);
      await sleep(retryAfter * 1000);
      continue;
    }
    throw new Error(`Jolpica request failed: ${res.status} ${res.statusText} for ${url}`);
  }
}

// Fetches every page of an endpoint and returns the MRData envelopes, one per page.
// Ergast paginates over the innermost rows (e.g. individual results or lap timings),
// so a race can be split across two pages; mergeRaces() below joins them back up.
async function getAllPages(path) {
  const pages = [];
  let offset = 0;
  for (;;) {
    const body = await getJson(path, { offset });
    const mr = body.MRData;
    pages.push(mr);
    const total = Number(mr.total);
    offset += PAGE_SIZE;
    if (offset >= total) break;
  }
  return pages;
}

// Joins race rows that were split across pages. `key` is the array inside each race
// (Results, QualifyingResults, SprintResults, Laps).
function mergeRaces(pages, key) {
  const byRound = new Map();
  for (const page of pages) {
    for (const race of page.RaceTable?.Races || []) {
      const existing = byRound.get(race.round);
      if (!existing) byRound.set(race.round, { ...race, [key]: [...(race[key] || [])] });
      else existing[key].push(...(race[key] || []));
    }
  }
  return [...byRound.values()].sort((a, b) => Number(a.round) - Number(b.round));
}

module.exports = { BASE_URL, USER_AGENT, getJson, getAllPages, mergeRaces };
