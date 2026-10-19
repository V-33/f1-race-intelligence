'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./fixtures/buildFixture');
const { processSeason } = require('../processing/src/processSeason');
const layout = require('../processing/src/awsLayout');
const { DynamoStore } = require('../backend/src/data/dynamoStore');

const { seasonData } = processSeason(2099, build());

// Fake DynamoDB: answers Query on the partition key and returns small pages to exercise pagination.
function fakeDynamo(items, { pageSize = 3, failWith } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      const input = command.input;
      calls.push(input);
      if (failWith) throw failWith;
      const all = items.filter((i) => i.PK === input.ExpressionAttributeValues[':pk']);
      const from = input.ExclusiveStartKey ? input.ExclusiveStartKey.offset : 0;
      const page = all.slice(from, from + pageSize);
      const more = from + pageSize < all.length;
      return { Items: page, LastEvaluatedKey: more ? { offset: from + pageSize } : undefined };
    },
  };
}

const items = [
  ...layout.splitSeason(seasonData),
  layout.indexItem(2099, 'x'),
  layout.indexItem(2024, 'y'),
];
const s3Stub = {
  getLaps: async (s, r) => ({ from: 's3', s, r }),
  getReport: async (s) => ({ from: 's3', s }),
};
const make = (client, extra = {}) => new DynamoStore({ table: 't', client, s3: s3Stub, ...extra });

test('getSeason rebuilds the full season across several query pages', async () => {
  const client = fakeDynamo(items);
  const store = make(client);
  assert.deepEqual(await store.getSeason(2099), seasonData);
  assert.ok(client.calls.length > 1, 'expected pagination');
  assert.ok(client.calls.every((c) => c.TableName === 't'));
});

test('listSeasons returns the numeric season list in order', async () => {
  assert.deepEqual(await make(fakeDynamo(items)).listSeasons(), [2024, 2099]);
});

test('unknown season gives null and an empty table gives no seasons', async () => {
  const store = make(fakeDynamo(items));
  assert.equal(await store.getSeason(1999), null);
  assert.deepEqual(await make(fakeDynamo([])).listSeasons(), []);
});

test('laps and reports come from S3', async () => {
  const store = make(fakeDynamo(items));
  assert.deepEqual(await store.getLaps(2099, 2), { from: 's3', s: 2099, r: 2 });
  assert.deepEqual(await store.getReport(2099), { from: 's3', s: 2099 });
});

test('DynamoDB errors propagate and are not turned into 404s', async () => {
  const denied = Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });
  await assert.rejects(make(fakeDynamo(items, { failWith: denied })).getSeason(2099), /not authorized/);
});

test('results are cached until the TTL expires', async () => {
  let t = 0;
  const client = fakeDynamo(items, { pageSize: 1000 });
  const store = make(client, { ttlMs: 1000, now: () => t });
  await store.getSeason(2099);
  await store.getSeason(2099);
  assert.equal(client.calls.length, 1);
  t = 1001;
  await store.getSeason(2099);
  assert.equal(client.calls.length, 2);
});

test('bad season ids never reach DynamoDB, and a table name is required', () => {
  const client = fakeDynamo(items);
  assert.throws(() => make(client).getSeason('x#y'), /invalid season/);
  assert.equal(client.calls.length, 0);
  assert.throws(() => new DynamoStore({}), /DDB_TABLE/);
});
