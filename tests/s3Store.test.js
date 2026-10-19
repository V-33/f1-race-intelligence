'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { S3Store } = require('../backend/src/data/s3Store');

// Fake S3: a map of key -> object. Records every request it receives.
// Listing (a request with a Delimiter) returns the "folders" under the prefix, one per page.
function fakeS3(objects, failWith) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.input);
      if (failWith) throw failWith;
      const { Bucket, Key, Prefix, Delimiter, ContinuationToken } = command.input;
      if (Delimiter) {
        const folders = [...new Set(Object.keys(objects).filter((k) => k.startsWith(Prefix)).map((k) => Prefix + k.slice(Prefix.length).split('/')[0] + (k.slice(Prefix.length).includes('/') ? '/' : '')))]
          .filter((p) => p.endsWith('/'));
        const i = Number(ContinuationToken || 0);
        return {
          CommonPrefixes: folders.slice(i, i + 1).map((p) => ({ Prefix: p })),
          IsTruncated: i + 1 < folders.length,
          NextContinuationToken: String(i + 1),
        };
      }
      if (Bucket !== 'test-bucket' || !(Key in objects)) {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      }
      return { Body: { transformToString: async () => JSON.stringify(objects[Key]) } };
    },
  };
}

const objects = {
  'processed/2023/season.json': { season: 2023, races: [] },
  'processed/notes/readme.json': {},
  'processed/2024/season.json': { season: 2024, races: [] },
  'processed/2024/report.json': { issues: [] },
  'processed/2024/laps/8.json': { round: 8 },
};
const make = (client, extra = {}) => new S3Store({ bucket: 'test-bucket', client, ...extra });

test('reads the four kinds of data from the expected keys', async () => {
  const store = make(fakeS3(objects));
  assert.deepEqual(await store.listSeasons(), [2023, 2024]);
  assert.equal((await store.getSeason(2024)).season, 2024);
  assert.deepEqual(await store.getReport('2024'), { issues: [] });
  assert.deepEqual(await store.getLaps(2024, 8), { round: 8 });
});

test('listSeasons lists the year folders across pages and ignores other folders', async () => {
  const client = fakeS3(objects);
  assert.deepEqual(await make(client).listSeasons(), [2023, 2024]);
  assert.ok(client.calls.length > 1, 'expected pagination');
  assert.ok(client.calls.every((c) => c.Prefix === 'processed/' && c.Delimiter === '/' && c.Bucket === 'test-bucket'));
});

test('missing objects return null, and an empty bucket gives no seasons', async () => {
  const store = make(fakeS3({}));
  assert.equal(await store.getSeason(2024), null);
  assert.equal(await store.getLaps(2024, 3), null);
  assert.equal(await store.getReport(2024), null);
  assert.deepEqual(await store.listSeasons(), []);
});

test('other errors (for example AccessDenied) are not hidden as 404', async () => {
  const denied = Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
  const store = make(fakeS3(objects, denied));
  await assert.rejects(store.getSeason(2024), /denied/);
});

test('results are cached until the TTL expires', async () => {
  let t = 0;
  const client = fakeS3(objects);
  const store = make(client, { ttlMs: 1000, now: () => t });
  await store.getSeason(2024);
  await store.getSeason(2024);
  assert.equal(client.calls.length, 1);
  t = 1001;
  await store.getSeason(2024);
  assert.equal(client.calls.length, 2);
});

test('requests only ever name the configured bucket, and bad ids never reach S3', async () => {
  const client = fakeS3(objects);
  const store = make(client);
  await store.getSeason(2024);
  assert.ok(client.calls.every((c) => c.Bucket === 'test-bucket'));
  assert.throws(() => store.getSeason('../x'), /invalid season/);
  assert.equal(client.calls.length, 1);
});

test('a bucket name is required', () => {
  assert.throws(() => new S3Store({}), /S3_BUCKET/);
});
