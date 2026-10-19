'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('./fixtures/buildFixture');
const { processSeason } = require('../processing/src/processSeason');
const { LocalStore } = require('../backend/src/data/localStore');
const { createApp } = require('../backend/src/app');

// Write the synthetic season to a temp folder and start the app on a random port.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-api-'));
const out = processSeason(2099, build());
fs.mkdirSync(path.join(dir, '2099', 'laps'), { recursive: true });
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ seasons: [2099] }));
fs.writeFileSync(path.join(dir, '2099', 'season.json'), JSON.stringify(out.seasonData));
fs.writeFileSync(path.join(dir, '2099', 'report.json'), JSON.stringify(out.report));
fs.writeFileSync(path.join(dir, '2099', 'laps', '1.json'), JSON.stringify(out.lapData[1]));

let server;
let base;
test.before(async () => {
  server = createApp(new LocalStore(dir)).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};

test('health and seasons', async () => {
  assert.equal((await get('/api/health')).body.status, 'ok');
  assert.deepEqual((await get('/api/seasons')).body.seasons, [2099]);
});

test('season, race, laps and report endpoints', async () => {
  const s = await get('/api/seasons/2099');
  assert.equal(s.status, 200);
  assert.equal(s.body.races.length, 3);
  assert.equal((await get('/api/seasons/2099/races/2')).body.round, 2);
  assert.equal((await get('/api/seasons/2099/races/1/laps')).body.totalLaps, 10);
  assert.equal((await get('/api/seasons/2099/report')).body.pointsCheck.matched, 6);
});

test('compare returns per-race rows for each driver', async () => {
  const r = await get('/api/seasons/2099/compare?drivers=alpha,charlie');
  assert.equal(r.status, 200);
  assert.equal(r.body.drivers.length, 2);
  assert.equal(r.body.drivers[0].byRace.length, 3);
});

test('bad input gets 400, missing data gets 404, and no stack traces leak', async () => {
  assert.equal((await get('/api/seasons/abcd')).status, 400);
  assert.equal((await get('/api/seasons/2099/races/99')).status, 400);
  assert.equal((await get('/api/seasons/2099/compare?drivers=../etc')).status, 400);
  assert.equal((await get('/api/seasons/2099/compare?drivers=a,b,c,d,e,f,g')).status, 400);
  assert.equal((await get('/api/seasons/2098')).status, 404);
  assert.equal((await get('/api/seasons/2099/races/2/laps')).status, 404);
  assert.equal((await get('/api/seasons/2099/compare?drivers=nobody')).status, 404);
  const r = await get('/api/nope');
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.body).includes('at '));
});

test('security headers are set', async () => {
  const r = await get('/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('dashboard and chart library are served', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /F1 Race Intelligence/);
  assert.equal((await fetch(`${base}/vendor/chart.umd.min.js`)).status, 200);
});
