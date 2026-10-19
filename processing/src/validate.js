'use strict';
// Validation and cleaning of raw Jolpica/Ergast records.
// Every function returns clean, typed records and pushes anything suspicious into `issues`
// (level "error" = row dropped, "warn" = row kept but flagged).

const ID_RE = /^[a-z0-9_]{1,64}$/;

function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "1:29.421" -> 89421, "58.123" -> 58123, anything else -> null
function parseLapTime(t) {
  if (typeof t !== 'string' || !t.trim()) return null;
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}(?:\.\d{1,3})?)$/);
  if (!m) return null;
  const ms = Math.round(((Number(m[1]) || 0) * 60 + Number(m[2])) * 1000);
  return ms > 0 ? ms : null;
}

function driverOf(d) {
  return {
    id: d.driverId,
    code: d.code || d.familyName?.slice(0, 3).toUpperCase() || d.driverId.slice(0, 3).toUpperCase(),
    number: toInt(d.permanentNumber),
    name: `${d.givenName || ''} ${d.familyName || ''}`.trim(),
    nationality: d.nationality || null,
  };
}

function constructorOf(c) {
  return { id: c.constructorId, name: c.name, nationality: c.nationality || null };
}

function validRef(obj, idKey) {
  return obj && typeof obj[idKey] === 'string' && ID_RE.test(obj[idKey]);
}

function cleanRace(race, issues) {
  const round = toInt(race.round);
  if (!round || round < 1 || !race.raceName) {
    issues.push({ level: 'error', where: `race ${race.round}`, message: 'missing round or name, dropped' });
    return null;
  }
  return {
    round,
    name: race.raceName,
    date: /^\d{4}-\d{2}-\d{2}$/.test(race.date) ? race.date : null,
    circuitId: race.Circuit?.circuitId || null,
    circuit: race.Circuit?.circuitName || null,
    locality: race.Circuit?.Location?.locality || null,
    country: race.Circuit?.Location?.country || null,
  };
}

// Shared checks for race and sprint classification rows.
function cleanResultRows(rows, where, issues, registry) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!validRef(r.Driver, 'driverId') || !validRef(r.Constructor, 'constructorId')) {
      issues.push({ level: 'error', where, message: 'result without valid driver/constructor id, dropped' });
      continue;
    }
    const driverId = r.Driver.driverId;
    if (seen.has(driverId)) {
      issues.push({ level: 'error', where, message: `duplicate result for ${driverId}, dropped` });
      continue;
    }
    const position = toInt(r.position);
    const grid = toInt(r.grid);
    const points = toNum(r.points);
    if (position === null || position < 1 || points === null || points < 0 || grid === null || grid < 0) {
      issues.push({ level: 'error', where, message: `bad position/grid/points for ${driverId}, dropped` });
      continue;
    }
    seen.add(driverId);
    registry.drivers.set(driverId, driverOf(r.Driver));
    registry.constructors.set(r.Constructor.constructorId, constructorOf(r.Constructor));
    // positionText is a number when classified; R = retired, D = disqualified, W = withdrawn, etc.
    const classified = /^\d+$/.test(String(r.positionText));
    out.push({
      driverId,
      constructorId: r.Constructor.constructorId,
      position,
      positionText: String(r.positionText),
      classified,
      grid: grid === 0 ? null : grid, // 0 = started from pit lane
      pitLaneStart: grid === 0,
      points,
      laps: toInt(r.laps) ?? 0,
      status: r.status || null,
      timeMs: toInt(r.Time?.millis),
      fastestLapRank: toInt(r.FastestLap?.rank),
      fastestLapMs: parseLapTime(r.FastestLap?.Time?.time),
    });
  }
  out.sort((a, b) => a.position - b.position);
  return out;
}

function cleanQualifying(rows, where, issues, registry) {
  const out = [];
  const seen = new Set();
  for (const q of rows || []) {
    if (!validRef(q.Driver, 'driverId') || !validRef(q.Constructor, 'constructorId')) {
      issues.push({ level: 'error', where, message: 'qualifying row without valid ids, dropped' });
      continue;
    }
    const position = toInt(q.position);
    if (!position || seen.has(q.Driver.driverId)) {
      issues.push({ level: 'error', where, message: `bad/duplicate qualifying row for ${q.Driver.driverId}, dropped` });
      continue;
    }
    seen.add(q.Driver.driverId);
    registry.drivers.set(q.Driver.driverId, driverOf(q.Driver));
    registry.constructors.set(q.Constructor.constructorId, constructorOf(q.Constructor));
    const q1 = parseLapTime(q.Q1);
    const q2 = parseLapTime(q.Q2);
    const q3 = parseLapTime(q.Q3);
    const times = [q1, q2, q3].filter(Boolean);
    if (!times.length) issues.push({ level: 'warn', where, message: `no qualifying time for ${q.Driver.driverId}` });
    out.push({
      driverId: q.Driver.driverId,
      constructorId: q.Constructor.constructorId,
      position,
      q1Ms: q1,
      q2Ms: q2,
      q3Ms: q3,
      bestMs: times.length ? Math.min(...times) : null,
    });
  }
  out.sort((a, b) => a.position - b.position);
  return out;
}

// Raw laps -> { driverId: [ms or null, ...] } indexed by lap number - 1.
// Lap times outside 30 s .. 15 min are treated as data errors (dropped to null).
function cleanLaps(rawRace, where, issues) {
  const byDriver = {};
  let maxLap = 0;
  for (const lap of rawRace?.Laps || []) {
    const n = toInt(lap.number);
    if (!n || n < 1) continue;
    maxLap = Math.max(maxLap, n);
    for (const t of lap.Timings || []) {
      if (!validRef(t, 'driverId')) continue;
      const ms = parseLapTime(t.time);
      (byDriver[t.driverId] ||= []);
      if (ms === null || ms < 30000 || ms > 900000) {
        issues.push({ level: 'warn', where, message: `lap ${n} for ${t.driverId} has invalid time "${t.time}"` });
        byDriver[t.driverId][n - 1] = null;
      } else {
        byDriver[t.driverId][n - 1] = ms;
      }
    }
  }
  for (const id of Object.keys(byDriver)) {
    const arr = byDriver[id];
    for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = null;
  }
  return { totalLaps: maxLap, drivers: byDriver };
}

module.exports = { parseLapTime, toInt, toNum, cleanRace, cleanResultRows, cleanQualifying, cleanLaps, ID_RE };
