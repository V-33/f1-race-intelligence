'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./fixtures/buildFixture');
const { processSeason } = require('../processing/src/processSeason');

const raw = build();
const { seasonData, lapData, report } = processSeason(2099, raw);
const stat = (id) => seasonData.driverStats.find((d) => d.driverId === id);

test('computed points (race + sprint) match the official standings', () => {
  assert.equal(report.pointsCheck.checked, 6);
  assert.equal(report.pointsCheck.matched, 6);
  for (const [id, pts] of Object.entries(raw.totals)) assert.equal(stat(id).points, pts);
});

test('duplicate result row is reported and dropped', () => {
  assert.equal(seasonData.races[0].results.length, 6);
  assert.ok(report.issues.some((i) => i.level === 'error' && /duplicate/.test(i.message)));
});

test('driver metrics', () => {
  const alpha = stat('alpha'); // finishes 1,2,2 ; grid 2,1,2
  assert.equal(alpha.wins, 1);
  assert.equal(alpha.podiums, 3);
  assert.equal(alpha.avgFinish, 1.67);
  assert.equal(alpha.avgPositionsGained, 0);
  assert.equal(alpha.avgGrid, 1.67);
  assert.equal(alpha.poles, 1);
  const foxtrot = stat('foxtrot'); // retired in round 3
  assert.equal(foxtrot.dnfs, 1);
  assert.equal(foxtrot.starts, 3);
});

test('cumulative points progression ends at season total', () => {
  for (const s of seasonData.driverStats) assert.equal(seasonData.progression.drivers[s.driverId].at(-1), s.points);
  assert.deepEqual(seasonData.progression.rounds, [1, 2, 3]);
});

test('constructor totals equal the sum of their drivers', () => {
  const red = seasonData.constructorStats.find((c) => c.constructorId === 'red_team');
  assert.equal(red.points, stat('alpha').points + stat('bravo').points);
});

test('qualifying gap to pole', () => {
  const gaps = seasonData.races[0].qualifyingGaps;
  assert.equal(gaps[0].gapMs, 0);
  assert.equal(gaps[1].gapMs, 200);
});

test('lap stats filter the slow pit lap from consistency', () => {
  const s = lapData[1].stats.alpha;
  assert.equal(s.laps, 10);
  assert.equal(s.representativeLaps, 9);
  assert.equal(lapData[1].drivers.bravo[3], null);
});

test('teammate qualifying head-to-head counts every round', () => {
  for (const t of seasonData.teammateQualifying) assert.equal(t.wins[0] + t.wins[1], 3);
});
