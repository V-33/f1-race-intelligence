#!/usr/bin/env node
'use strict';
// Downloads raw historical data for one season from Jolpica-F1 into data/raw/<season>/.
//
//   node processing/scripts/ingest.js 2024                 # results, quali, sprints, standings
//   node processing/scripts/ingest.js 2024 --laps 1,8,22   # plus lap times for those rounds
//   node processing/scripts/ingest.js 2024 --laps all      # lap times for every round (~300 requests)
//
// Raw files are kept close to the source format so processing can be re-run offline.

const fs = require('node:fs');
const path = require('node:path');
const { BASE_URL, getAllPages, mergeRaces } = require('../src/jolpica');

const RAW_DIR = process.env.RAW_DIR || path.join(__dirname, '..', '..', 'data', 'raw');

function parseArgs(argv) {
  const season = Number(argv[0]);
  if (!Number.isInteger(season) || season < 1950 || season > new Date().getFullYear()) {
    throw new Error('Usage: ingest.js <season> [--laps all|1,2,3]');
  }
  const i = argv.indexOf('--laps');
  let laps = [];
  if (i !== -1) {
    const v = argv[i + 1] || '';
    laps = v === 'all' ? 'all' : v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  return { season, laps };
}

function write(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 1));
}

async function ingestSeason(season, laps = []) {
  const dir = path.join(RAW_DIR, String(season));
  const started = Date.now();
  let requests = 0;
  const fetchRaces = async (endpoint, key) => {
    const pages = await getAllPages(`${season}/${endpoint}`);
    requests += pages.length;
    return mergeRaces(pages, key);
  };

  console.log(`[ingest] season ${season} from ${BASE_URL}`);
  const schedule = await getAllPages(`${season}/races`);
  requests += schedule.length;
  const races = schedule.flatMap((p) => p.RaceTable.Races);
  write(dir, 'races.json', races);
  console.log(`[ingest] ${races.length} races in schedule`);

  write(dir, 'results.json', await fetchRaces('results', 'Results'));
  write(dir, 'qualifying.json', await fetchRaces('qualifying', 'QualifyingResults'));
  write(dir, 'sprint.json', await fetchRaces('sprint', 'SprintResults'));

  const ds = await getAllPages(`${season}/driverstandings`);
  const cs = await getAllPages(`${season}/constructorstandings`);
  requests += ds.length + cs.length;
  write(dir, 'driverstandings.json', ds[0].StandingsTable.StandingsLists);
  write(dir, 'constructorstandings.json', cs[0].StandingsTable.StandingsLists);

  const lapRounds = laps === 'all' ? races.map((r) => Number(r.round)) : laps;
  for (const round of lapRounds) {
    const merged = await fetchRaces(`${round}/laps`, 'Laps');
    write(path.join(dir, 'laps'), `${round}.json`, merged[0] || null);
    console.log(`[ingest] laps for round ${round}: ${merged[0]?.Laps?.length || 0} laps`);
  }

  const manifest = {
    season,
    source: BASE_URL,
    license: 'CC BY-NC-SA 4.0 (Jolpica-F1)',
    fetchedAt: new Date().toISOString(),
    requests,
    durationMs: Date.now() - started,
    lapRounds,
  };
  write(dir, 'manifest.json', manifest);
  console.log(`[ingest] done: ${requests} requests in ${manifest.durationMs} ms -> ${dir}`);
  return manifest;
}

if (require.main === module) {
  const { season, laps } = parseArgs(process.argv.slice(2));
  ingestSeason(season, laps).catch((err) => {
    console.error(`[ingest] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { ingestSeason };
