'use strict';
// Metric calculations. Pure functions over cleaned data (no I/O), so the same code runs
// in the CLI scripts today and inside the Lambda processing function later.

const round1 = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? null : Number(n.toFixed(d)));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// Gap of each driver's best qualifying lap to pole, in ms and percent.
function qualifyingGaps(qualifying) {
  const best = Math.min(...qualifying.map((q) => q.bestMs).filter(Boolean));
  const ref = Number.isFinite(best) ? best : null;
  return qualifying.map((q) => ({
    driverId: q.driverId,
    position: q.position,
    bestMs: q.bestMs,
    gapMs: q.bestMs && ref ? q.bestMs - ref : null,
    gapPct: q.bestMs && ref ? round1(((q.bestMs - ref) / ref) * 100, 3) : null,
  }));
}

// Per-driver lap statistics for one race. "Representative" laps are within 107% of the
// driver's median, which filters out pit-stop, safety-car and first laps.
function lapStats(laps) {
  const out = {};
  for (const [driverId, times] of Object.entries(laps.drivers)) {
    const valid = times.filter((t) => t !== null);
    const med = median(valid);
    const rep = valid.filter((t) => t <= med * 1.07);
    out[driverId] = {
      laps: valid.length,
      fastestMs: valid.length ? Math.min(...valid) : null,
      medianMs: med === null ? null : Math.round(med),
      representativeLaps: rep.length,
      consistencyMs: rep.length > 1 ? Math.round(stdev(rep)) : null,
    };
  }
  return out;
}

function emptyDriverAcc(driverId) {
  return {
    driverId, constructors: new Set(), starts: 0, points: 0, wins: 0, podiums: 0, poles: 0,
    dnfs: 0, fastestLaps: 0, sprintPoints: 0, finishes: [], grids: [], quali: [], changes: [],
  };
}

// Builds driver and constructor season statistics plus cumulative points by round.
function seasonStats(races) {
  const drivers = new Map();
  const teams = new Map();
  const rounds = races.map((r) => r.round);
  const driverRoundPts = new Map();
  const teamRoundPts = new Map();
  const addPts = (map, id, idx, pts) => {
    if (!map.has(id)) map.set(id, new Array(rounds.length).fill(0));
    map.get(id)[idx] += pts;
  };
  const team = (id) => {
    if (!teams.has(id)) teams.set(id, { constructorId: id, points: 0, wins: 0, podiums: 0, oneTwos: 0, dnfs: 0, entries: 0, finishes: [] });
    return teams.get(id);
  };

  races.forEach((race, idx) => {
    for (const q of race.qualifying) {
      const d = drivers.get(q.driverId) || emptyDriverAcc(q.driverId);
      drivers.set(q.driverId, d);
      d.quali.push(q.position);
      if (q.position === 1) d.poles++;
    }
    for (const r of race.results) {
      const d = drivers.get(r.driverId) || emptyDriverAcc(r.driverId);
      drivers.set(r.driverId, d);
      const t = team(r.constructorId);
      d.constructors.add(r.constructorId);
      d.starts++;
      t.entries++;
      d.points += r.points;
      t.points += r.points;
      addPts(driverRoundPts, r.driverId, idx, r.points);
      addPts(teamRoundPts, r.constructorId, idx, r.points);
      if (r.classified) {
        d.finishes.push(r.position);
        t.finishes.push(r.position);
      } else {
        d.dnfs++;
        t.dnfs++;
      }
      if (r.position === 1 && r.classified) { d.wins++; t.wins++; }
      if (r.position <= 3 && r.classified) { d.podiums++; t.podiums++; }
      if (r.fastestLapRank === 1) d.fastestLaps++;
      if (r.grid) d.grids.push(r.grid);
      if (r.grid && r.classified) d.changes.push(r.grid - r.position);
    }
    const top2 = race.results.filter((r) => r.classified && r.position <= 2);
    if (top2.length === 2 && top2[0].constructorId === top2[1].constructorId) team(top2[0].constructorId).oneTwos++;
    for (const s of race.sprint || []) {
      const d = drivers.get(s.driverId) || emptyDriverAcc(s.driverId);
      drivers.set(s.driverId, d);
      d.points += s.points;
      d.sprintPoints += s.points;
      team(s.constructorId).points += s.points;
      addPts(driverRoundPts, s.driverId, idx, s.points);
      addPts(teamRoundPts, s.constructorId, idx, s.points);
    }
  });

  const cumulative = (arr) => arr.reduce((acc, v, i) => (acc.push((acc[i - 1] || 0) + v), acc), []);

  const driverStats = [...drivers.values()].map((d) => ({
    driverId: d.driverId,
    constructors: [...d.constructors],
    starts: d.starts,
    points: d.points,
    sprintPoints: d.sprintPoints,
    wins: d.wins,
    podiums: d.podiums,
    poles: d.poles,
    fastestLaps: d.fastestLaps,
    dnfs: d.dnfs,
    bestFinish: d.finishes.length ? Math.min(...d.finishes) : null,
    avgFinish: round1(mean(d.finishes)),
    avgGrid: round1(mean(d.grids)),
    avgQualifying: round1(mean(d.quali)),
    avgPositionsGained: round1(mean(d.changes)),
    totalPositionsGained: d.changes.reduce((a, b) => a + b, 0),
    pointsPerStart: d.starts ? round1(d.points / d.starts) : null,
  })).sort((a, b) => b.points - a.points || (a.bestFinish ?? 99) - (b.bestFinish ?? 99));

  const constructorStats = [...teams.values()].map((t) => ({
    constructorId: t.constructorId,
    points: t.points,
    wins: t.wins,
    podiums: t.podiums,
    oneTwos: t.oneTwos,
    dnfs: t.dnfs,
    entries: t.entries,
    avgFinish: round1(mean(t.finishes)),
  })).sort((a, b) => b.points - a.points);

  const progression = {
    rounds,
    drivers: Object.fromEntries([...driverRoundPts].map(([id, a]) => [id, cumulative(a)])),
    constructors: Object.fromEntries([...teamRoundPts].map(([id, a]) => [id, cumulative(a)])),
  };

  return { driverStats, constructorStats, progression };
}

// Teammate qualifying head-to-head: for each constructor, who out-qualified whom how often.
function teammateQualifying(races) {
  const h2h = {};
  for (const race of races) {
    const byTeam = {};
    for (const q of race.qualifying) (byTeam[q.constructorId] ||= []).push(q);
    for (const [teamId, pair] of Object.entries(byTeam)) {
      if (pair.length !== 2) continue;
      const [a, b] = [...pair].sort((x, y) => x.driverId.localeCompare(y.driverId));
      const key = `${a.driverId}|${b.driverId}`;
      const rec = (h2h[key] ||= { constructorId: teamId, drivers: [a.driverId, b.driverId], wins: [0, 0], gapsMs: [] });
      rec.wins[a.position < b.position ? 0 : 1]++;
      if (a.bestMs && b.bestMs) rec.gapsMs.push(a.bestMs - b.bestMs);
    }
  }
  return Object.values(h2h).map((r) => ({
    constructorId: r.constructorId,
    drivers: r.drivers,
    wins: r.wins,
    medianGapMs: r.gapsMs.length ? Math.round(median(r.gapsMs)) : null, // negative = first driver faster
  }));
}

module.exports = { mean, median, stdev, qualifyingGaps, lapStats, seasonStats, teammateQualifying };
