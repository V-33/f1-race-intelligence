#!/usr/bin/env node
'use strict';
// Reads data/raw/<season>/ and writes data/processed/<season>/{season,report}.json and laps/<round>.json.
//   node processing/scripts/process.js 2024

const fs = require('node:fs');
const path = require('node:path');
const { processSeason } = require('../src/processSeason');

const ROOT = path.join(__dirname, '..', '..', 'data');
const RAW_DIR = process.env.RAW_DIR || path.join(ROOT, 'raw');
const OUT_DIR = process.env.PROCESSED_DIR || path.join(ROOT, 'processed');

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function loadRaw(season) {
  const dir = path.join(RAW_DIR, String(season));
  if (!fs.existsSync(dir)) throw new Error(`No raw data in ${dir}. Run: npm run ingest -- ${season}`);
  const laps = {};
  const lapDir = path.join(dir, 'laps');
  if (fs.existsSync(lapDir)) {
    for (const f of fs.readdirSync(lapDir).filter((f) => /^\d+\.json$/.test(f))) {
      const data = readJson(path.join(lapDir, f), null);
      if (data) laps[Number(f.replace('.json', ''))] = data;
    }
  }
  const files = ['races', 'results', 'qualifying', 'sprint', 'driverstandings', 'constructorstandings'];
  return Object.fromEntries([...files.map((f) => [f, readJson(path.join(dir, `${f}.json`), [])]), ['laps', laps]]);
}

function writeSeason(season, { seasonData, lapData, report }) {
  const dir = path.join(OUT_DIR, String(season));
  fs.mkdirSync(path.join(dir, 'laps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'season.json'), JSON.stringify(seasonData));
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  for (const [round, laps] of Object.entries(lapData)) {
    fs.writeFileSync(path.join(dir, 'laps', `${round}.json`), JSON.stringify(laps));
  }
  // Index of available seasons, read by the backend's /api/seasons
  const seasons = fs.readdirSync(OUT_DIR).filter((d) => /^\d{4}$/.test(d)).map(Number).sort((a, b) => b - a);
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({ seasons, updatedAt: new Date().toISOString() }, null, 2));
}

if (require.main === module) {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season)) {
    console.error('Usage: process.js <season>');
    process.exit(1);
  }
  try {
    const out = processSeason(season, loadRaw(season));
    writeSeason(season, out);
    const r = out.report;
    console.log(`[process] ${season}: ${r.racesProcessed} races, ${r.lapRounds.length} with laps, ` +
      `${r.errors} errors, ${r.warnings} warnings, points check ${r.pointsCheck.matched}/${r.pointsCheck.checked}`);
  } catch (err) {
    console.error(`[process] FAILED: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { loadRaw, writeSeason };
