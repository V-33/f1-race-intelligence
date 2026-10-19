'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../processing/src/validate');

test('parseLapTime handles minutes, seconds and junk', () => {
  assert.equal(v.parseLapTime('1:29.421'), 89421);
  assert.equal(v.parseLapTime('58.1'), 58100);
  assert.equal(v.parseLapTime(''), null);
  assert.equal(v.parseLapTime('DNF'), null);
  assert.equal(v.parseLapTime(undefined), null);
});

test('cleanResultRows drops duplicates and bad rows, and flags pit-lane starts', () => {
  const issues = [];
  const reg = { drivers: new Map(), constructors: new Map() };
  const D = (id) => ({ driverId: id, givenName: 'A', familyName: 'B' });
  const C = { constructorId: 'team', name: 'Team' };
  const rows = [
    { position: '1', positionText: '1', points: '25', grid: '0', Driver: D('a'), Constructor: C },
    { position: '1', positionText: '1', points: '25', grid: '1', Driver: D('a'), Constructor: C },
    { position: 'x', positionText: 'R', points: '0', grid: '2', Driver: D('b'), Constructor: C },
    { position: '2', positionText: '2', points: '18', grid: '2', Driver: { driverId: 'Bad Id!' }, Constructor: C },
  ];
  const out = v.cleanResultRows(rows, 'test', issues, reg);
  assert.equal(out.length, 1);
  assert.equal(out[0].pitLaneStart, true);
  assert.equal(out[0].grid, null);
  assert.equal(issues.filter((i) => i.level === 'error').length, 3);
});

test('cleanLaps nulls invalid lap times', () => {
  const issues = [];
  const out = v.cleanLaps({ Laps: [
    { number: '1', Timings: [{ driverId: 'a', time: '1:30.000' }] },
    { number: '2', Timings: [{ driverId: 'a', time: '0:05.000' }] },
  ] }, 'laps', issues);
  assert.deepEqual(out.drivers.a, [90000, null]);
  assert.equal(out.totalLaps, 2);
  assert.equal(issues.length, 1);
});
