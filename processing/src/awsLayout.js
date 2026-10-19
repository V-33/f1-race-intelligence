'use strict';
// How a processed season is laid out in DynamoDB and S3. Pure functions, no AWS calls.
// Shared by the upload script and dynamoStore so reads and writes always agree.
//
// DynamoDB (single table, see docs/ARCHITECTURE.md):
//   SEASONS        / <season>        index entry
//   SEASON#<year>  / SUMMARY         everything in season.json except races and driverStats
//   SEASON#<year>  / RACE#<nn>       one race
//   SEASON#<year>  / DRIVER#<id>     one driverStats entry (idx keeps the original order)
// Each item stores its payload in a "data" attribute.
//
// S3 (mirrors data/processed/, without index.json: the season list is the processed/<year>/ folders):
//   processed/<year>/season.json, report.json, laps/<round>.json

const SEASONS_PK = 'SEASONS';

function int(value, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid ${what}: ${value}`);
  return n;
}

const seasonPk = (season) => `SEASON#${int(season, 'season')}`;
const racePk = (round) => `RACE#${String(int(round, 'round')).padStart(2, '0')}`;
const driverSk = (driverId) => `DRIVER#${driverId}`;

const s3Keys = {
  prefix: () => 'processed/', // each season is a "folder" below it; S3Store lists them instead of reading an index file
  season: (season) => `processed/${int(season, 'season')}/season.json`,
  report: (season) => `processed/${int(season, 'season')}/report.json`,
  laps: (season, round) => `processed/${int(season, 'season')}/laps/${int(round, 'round')}.json`,
};

// season.json object -> DynamoDB items (without the SEASONS index entry)
function splitSeason(seasonData) {
  const { races = [], driverStats = [], ...summary } = seasonData;
  const pk = seasonPk(summary.season);
  return [
    { PK: pk, SK: 'SUMMARY', data: summary },
    ...races.map((race) => ({ PK: pk, SK: racePk(race.round), data: race })),
    ...driverStats.map((stats, idx) => ({ PK: pk, SK: driverSk(stats.driverId), idx, data: stats })),
  ];
}

// DynamoDB items for one season (any order) -> season.json object, or null if there is no summary
function assembleSeason(items) {
  const summary = items.find((i) => i.SK === 'SUMMARY');
  if (!summary) return null;
  const races = items.filter((i) => i.SK.startsWith('RACE#')).sort((a, b) => (a.SK < b.SK ? -1 : 1));
  const drivers = items.filter((i) => i.SK.startsWith('DRIVER#')).sort((a, b) => a.idx - b.idx);
  return { ...summary.data, races: races.map((i) => i.data), driverStats: drivers.map((i) => i.data) };
}

const indexItem = (season, updatedAt) => ({ PK: SEASONS_PK, SK: String(int(season, 'season')), updatedAt });

module.exports = { SEASONS_PK, seasonPk, racePk, driverSk, s3Keys, splitSeason, assembleSeason, indexItem };
