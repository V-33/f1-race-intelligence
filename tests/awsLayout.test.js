'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./fixtures/buildFixture');
const { processSeason } = require('../processing/src/processSeason');
const layout = require('../processing/src/awsLayout');

const { seasonData } = processSeason(2099, build());

test('splitSeason makes one summary, one item per race and one per driver', () => {
  const items = layout.splitSeason(seasonData);
  assert.equal(items.filter((i) => i.SK === 'SUMMARY').length, 1);
  assert.equal(items.filter((i) => i.SK.startsWith('RACE#')).length, seasonData.races.length);
  assert.equal(items.filter((i) => i.SK.startsWith('DRIVER#')).length, seasonData.driverStats.length);
  assert.ok(items.every((i) => i.PK === 'SEASON#2099'));
  assert.equal(items.find((i) => i.SK === 'SUMMARY').data.races, undefined);
});

test('assembleSeason restores the original season, whatever order items arrive in', () => {
  const items = layout.splitSeason(seasonData).reverse();
  assert.deepEqual(layout.assembleSeason(items), seasonData);
});

test('round trip is lossless for the real processed data, and every item fits in DynamoDB', (t) => {
  let real;
  try { real = require('../data/processed/2024/season.json'); } catch { return t.skip('no processed 2024 data'); }
  const items = layout.splitSeason(real);
  assert.deepEqual(layout.assembleSeason(items), real);
  for (const item of items) assert.ok(Buffer.byteLength(JSON.stringify(item)) < 350 * 1024, item.SK);
});

test('assembleSeason returns null without a summary item', () => {
  assert.equal(layout.assembleSeason([]), null);
});

test('keys', () => {
  assert.equal(layout.racePk(5), 'RACE#05');
  assert.equal(layout.racePk(12), 'RACE#12');
  assert.equal(layout.s3Keys.laps(2024, 8), 'processed/2024/laps/8.json');
  assert.equal(layout.s3Keys.season('2024'), 'processed/2024/season.json');
  assert.deepEqual(layout.indexItem(2024, 'x'), { PK: 'SEASONS', SK: '2024', updatedAt: 'x' });
});

test('key builders reject anything that is not a whole number', () => {
  assert.throws(() => layout.s3Keys.season('../x'), /invalid season/);
  assert.throws(() => layout.s3Keys.laps(2024, '1/2'), /invalid round/);
  assert.throws(() => layout.seasonPk(-1), /invalid season/);
});
