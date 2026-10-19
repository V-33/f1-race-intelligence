'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('./fixtures/buildFixture');
const { processSeason } = require('../processing/src/processSeason');
const { planUpload, uploadFiles, writeItems, parseArgs } = require('../processing/scripts/upload');

// A small processed folder: season 2099 with two lap files and a stray .gitkeep
const { seasonData, report } = processSeason(2099, build());
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-upload-'));
fs.mkdirSync(path.join(dir, '2099', 'laps'), { recursive: true });
fs.writeFileSync(path.join(dir, '2099', 'season.json'), JSON.stringify(seasonData));
fs.writeFileSync(path.join(dir, '2099', 'report.json'), JSON.stringify(report));
fs.writeFileSync(path.join(dir, '2099', 'laps', '1.json'), '{"round":1}');
fs.writeFileSync(path.join(dir, '2099', 'laps', '12.json'), '{"round":12}');
fs.writeFileSync(path.join(dir, '2099', 'laps', 'notes.txt'), 'ignore me');
fs.writeFileSync(path.join(dir, '.gitkeep'), '');
fs.writeFileSync(path.join(dir, 'index.json'), '{"seasons":[2099]}');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('plan lists exactly the expected S3 keys and skips stray files', () => {
  const { files } = planUpload(2099, dir, () => 'T');
  assert.deepEqual(files.map((f) => f.key).sort(), [
    'processed/2099/laps/1.json', 'processed/2099/laps/12.json', 'processed/2099/report.json',
    'processed/2099/season.json',
  ]);
});

test('plan builds the DynamoDB items including the season index entry', () => {
  const { items } = planUpload(2099, dir, () => 'T');
  assert.equal(items.length, 1 + seasonData.races.length + seasonData.driverStats.length + 1);
  assert.deepEqual(items.at(-1), { PK: 'SEASONS', SK: '2099', updatedAt: 'T' });
});

test('plan fails clearly when the season has not been processed, and rejects odd seasons', () => {
  assert.throws(() => planUpload(1990, dir), /npm run process -- 1990/);
  assert.throws(() => planUpload('../x', dir), /invalid season/);
});

test('uploadFiles puts each file with the right bucket, key and content type', async () => {
  const sent = [];
  class Put { constructor(input) { this.input = input; } }
  const { files } = planUpload(2099, dir);
  await uploadFiles({ send: async (c) => sent.push(c.input) }, 'b', files, Put);
  assert.equal(sent.length, files.length);
  assert.ok(sent.every((s) => s.Bucket === 'b' && s.ContentType === 'application/json' && Buffer.isBuffer(s.Body)));
});

test('writeItems batches in groups of 25 and retries unprocessed items', async () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ PK: 'p', SK: String(i) }));
  class Batch { constructor(input) { this.input = input; } }
  const written = [];
  const sizes = [];
  let failedOnce = false;
  const client = {
    async send(c) {
      const reqs = c.input.RequestItems.t;
      sizes.push(reqs.length);
      if (!failedOnce) { // first call: DynamoDB accepts 20 and hands 5 back
        failedOnce = true;
        written.push(...reqs.slice(0, 20));
        return { UnprocessedItems: { t: reqs.slice(20) } };
      }
      written.push(...reqs);
      return { UnprocessedItems: {} };
    },
  };
  const waits = [];
  await writeItems(client, 't', items, Batch, async (ms) => waits.push(ms));
  assert.deepEqual(sizes, [25, 5, 25, 10]);
  assert.equal(written.length, 60);
  assert.equal(new Set(written.map((w) => w.PutRequest.Item.SK)).size, 60);
  assert.equal(waits.length, 1);
});

test('writeItems gives up after repeated unprocessed responses', async () => {
  class Batch { constructor(input) { this.input = input; } }
  const client = { send: async (c) => ({ UnprocessedItems: c.input.RequestItems }) };
  await assert.rejects(writeItems(client, 't', [{ PK: 'p', SK: '1' }], Batch, async () => {}), /unprocessed/);
});

test('argument parsing', () => {
  assert.deepEqual(parseArgs(['2024']), { season: 2024, only: null, dryRun: false });
  assert.deepEqual(parseArgs(['2024', '--only', 's3', '--dry-run']), { season: 2024, only: 's3', dryRun: true });
  assert.throws(() => parseArgs([]), /missing season/);
  assert.throws(() => parseArgs(['2024', '--only', 'x']), /--only/);
  assert.throws(() => parseArgs(['2024', '--force']), /unexpected argument/);
});
