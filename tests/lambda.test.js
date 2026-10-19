'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./fixtures/buildFixture');
const { createHandler, parseEvent } = require('../lambda/processSeason');
const { assembleSeason } = require('../processing/src/awsLayout');

function fixture(overrides = {}) {
  const raw = build();
  const objects = new Map();
  const items = [];
  const batches = [];
  const calls = [];
  const handler = createHandler({
    getAllPages: async path => {
      calls.push(path);
      const endpoint = path.split('/').slice(1).join('/');
      if (endpoint.endsWith('standings')) {
        const key = endpoint === 'driverstandings' ? 'DriverStandings' : 'ConstructorStandings';
        const list = raw[endpoint][0];
        return list[key].map(row => ({ StandingsTable: { StandingsLists: [{ ...list, [key]: [row] }] } }));
      }
      return [{ RaceTable: { Races: endpoint.endsWith('/laps') ? [raw.laps[1]] : raw[endpoint] } }];
    },
    putObject: async (key, value) => objects.set(key, value),
    putItem: async item => items.push(item),
    batchWrite: async data => batches.push(...data),
    logger: { log() {}, error() {} },
    ...overrides,
  });
  return { handler, objects, items, batches, calls };
}

test('Lambda publishes compatible season, laps, raw pages and a success record', async () => {
  const f = fixture();
  const result = await f.handler({ season: 2024, laps: [1, 1] }, { awsRequestId: 'test-run' });
  assert.equal(result.status, 'SUCCEEDED');
  assert.deepEqual(assembleSeason(f.batches), f.objects.get('processed/2024/season.json'));
  assert.equal(f.objects.get('processed/2024/report.json').pointsCheck.matched, 6);
  assert.ok(f.objects.get('processed/2024/laps/1.json').stats.alpha);
  assert.equal(f.calls.filter(p => p.endsWith('/laps')).length, 1);
  assert.equal(f.objects.get('raw/2024/driverstandings.json').length, 6);
  assert.ok(!f.objects.has('index.json'));
  assert.equal(f.items.at(-2).PK, 'SEASONS');
  assert.equal(f.items.at(-1).PK, 'RUN#2024');
  assert.equal(f.items.at(-1).data.status, 'SUCCEEDED');
  assert.equal(f.items.at(-1).data.counts.races, 3);
  assert.equal(f.items.at(-1).SK, f.items[0].SK);
});

test('invalid invocation records failure and rejects for the Errors alarm', async () => {
  const f = fixture();
  await assert.rejects(f.handler({ season: 1800 }), /Invalid season/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.items.at(-1).data.status, 'FAILED');
});

test('a storage failure is not published as success or indexed', async () => {
  const f = fixture({ batchWrite: async () => { throw new Error('AccessDenied'); } });
  await assert.rejects(f.handler({ season: 2024 }), /AccessDenied/);
  assert.ok(!f.items.some(i => i.PK === 'SEASONS'));
  assert.equal(f.items.at(-1).data.status, 'FAILED');
});

test('empty upstream data cannot replace an existing processed season', async () => {
  const f = fixture({ getAllPages: async () => [{ RaceTable: { Races: [] }, StandingsTable: { StandingsLists: [] } }] });
  await assert.rejects(f.handler({ season: 2024 }), /No completed races/);
  assert.ok([...f.objects.keys()].every(k => k.startsWith('raw/')));
  assert.equal(f.batches.length, 0);
});

test('event defaults and invalid lap inputs', () => {
  assert.deepEqual(parseEvent(), { season: new Date().getUTCFullYear(), laps: [] });
  for (const event of [null, [], { season: '2024' }, { laps: 'all' }, { laps: [0] }, { laps: [1.5] }]) {
    assert.throws(() => parseEvent(event));
  }
});
