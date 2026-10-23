'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalStore } = require('../backend/src/data/localStore');
const { createApp } = require('../backend/src/app');

const root = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssFiles = fs.readdirSync(path.join(root, 'css')).filter((f) => f.endsWith('.css'));

// The Content-Security-Policy only allows same-origin resources and no inline styles,
// so these are the things that would silently break the page in a browser.
test('index.html has no inline styles or style blocks', () => {
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
});

test('index.html loads scripts and stylesheets only from this site', () => {
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/gi)].map((m) => m[1]);
  assert.ok(refs.length >= 4);
  for (const ref of refs) assert.doesNotMatch(ref, /^(?:[a-z]+:)?\/\//i, `external resource: ${ref}`);
});

test('every local file referenced from index.html or the CSS exists', () => {
  const missing = [];
  const check = (base, ref) => {
    const clean = ref.split(/[?#]/)[0];
    if (!clean || /^(?:[a-z]+:|\/\/|data:)/i.test(clean) || clean.startsWith('vendor/') || clean.startsWith('/vendor/')) return;
    if (!fs.existsSync(path.join(base, clean))) missing.push(clean);
  };
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/gi)) check(root, m[1]);
  for (const f of cssFiles) {
    const css = fs.readFileSync(path.join(root, 'css', f), 'utf8');
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) check(path.join(root, 'css'), m[1]);
  }
  assert.deepEqual(missing, []);
});

// Browsers only autoplay video that is muted and inline, and clips are served from this site's own disk.
test('every video is muted, inline and small, and the file exists', () => {
  const videos = [...html.matchAll(/<video\b[^>]*>[\s\S]*?<\/video>/gi)].map((m) => m[0]);
  assert.ok(videos.length >= 1);
  for (const v of videos) {
    assert.match(v, /\smuted\b/, 'video must be muted');
    assert.match(v, /\splaysinline\b/, 'video must play inline');
    const src = /<source[^>]*\ssrc="([^"]+)"/i.exec(v)?.[1];
    assert.ok(src, 'video has no source');
    const poster = /\sposter="([^"]+)"/i.exec(v)?.[1];
    assert.ok(poster && fs.existsSync(path.join(root, poster)), `video ${src} needs an existing poster image`);
    const file = path.join(root, src);
    assert.ok(fs.existsSync(file), `missing ${src}`);
    assert.ok(fs.statSync(file).size < 8 * 1024 * 1024, `${src} is over 8 MB`);
  }
});

test('every font file ships with its licence text', () => {
  const dir = path.join(root, 'fonts');
  const files = fs.readdirSync(dir);
  assert.ok(files.some((f) => f.endsWith('.woff2')));
  assert.ok(files.some((f) => /^OFL/.test(f)));
  for (const f of files.filter((f) => f.endsWith('.woff2'))) {
    assert.equal(fs.readFileSync(path.join(dir, f)).subarray(0, 4).toString('latin1'), 'wOF2', `${f} is not a woff2 file`);
  }
});

test('the server serves the fonts, with the policy that allows them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-fonts-'));
  const server = createApp(new LocalStore(dir)).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/fonts/PublicSans-Variable.woff2`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.ok((await res.arrayBuffer()).byteLength > 10000);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
