'use strict';
// Turns one season of raw Jolpica data into the processed dataset the dashboard reads.
// Pure function: raw objects in, processed objects out. File/S3 I/O lives in the callers.

const v = require('./validate');
const m = require('./metrics');

// raw = { races, results, qualifying, sprint, driverstandings, constructorstandings, laps: {round: rawRace} }
function processSeason(season, raw) {
  const issues = [];
  const registry = { drivers: new Map(), constructors: new Map() };
  const byRound = (arr) => new Map((arr || []).map((r) => [Number(r.round), r]));
  const results = byRound(raw.results);
  const quali = byRound(raw.qualifying);
  const sprint = byRound(raw.sprint);

  const races = [];
  for (const rawRace of raw.races || []) {
    const race = v.cleanRace(rawRace, issues);
    if (!race) continue;
    const where = `round ${race.round}`;
    race.results = v.cleanResultRows(results.get(race.round)?.Results, where, issues, registry);
    race.qualifying = v.cleanQualifying(quali.get(race.round)?.QualifyingResults, `${where} qualifying`, issues, registry);
    race.sprint = v.cleanResultRows(sprint.get(race.round)?.SprintResults, `${where} sprint`, issues, registry);
    // Rounds without results are future/cancelled races: skip them.
    if (!race.results.length) {
      issues.push({ level: 'warn', where, message: 'no race results yet, round skipped' });
      continue;
    }
    race.qualifyingGaps = m.qualifyingGaps(race.qualifying);
    race.hasLaps = Boolean(raw.laps?.[race.round]);
    races.push(race);
  }

  const stats = m.seasonStats(races);
  const lapData = {};
  for (const race of races) {
    if (!race.hasLaps) continue;
    const laps = v.cleanLaps(raw.laps[race.round], `round ${race.round} laps`, issues);
    lapData[race.round] = { season, round: race.round, ...laps, stats: m.lapStats(laps) };
  }

  // Cross-check: points we calculated must match the official final standings.
  const official = raw.driverstandings?.at(-1);
  const checks = [];
  if (official) {
    for (const s of official.DriverStandings || []) {
      const ours = stats.driverStats.find((d) => d.driverId === s.Driver.driverId);
      const ok = ours && ours.points === Number(s.points);
      checks.push({ driverId: s.Driver.driverId, official: Number(s.points), computed: ours?.points ?? null, ok });
      if (!ok) issues.push({ level: 'warn', where: 'standings', message: `points mismatch for ${s.Driver.driverId}: official ${s.points}, computed ${ours?.points}` });
    }
  }

  const driverStandings = (official?.DriverStandings || []).map((s) => ({
    position: v.toInt(s.position), driverId: s.Driver.driverId, points: v.toNum(s.points), wins: v.toInt(s.wins),
    constructorId: s.Constructors?.at(-1)?.constructorId || null,
  }));
  const constructorStandings = (raw.constructorstandings?.at(-1)?.ConstructorStandings || []).map((s) => ({
    position: v.toInt(s.position), constructorId: s.Constructor.constructorId, points: v.toNum(s.points), wins: v.toInt(s.wins),
  }));

  const seasonData = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'Jolpica-F1 (CC BY-NC-SA 4.0)',
    standingsAfterRound: v.toInt(official?.round),
    drivers: Object.fromEntries(registry.drivers),
    constructors: Object.fromEntries(registry.constructors),
    races,
    driverStandings,
    constructorStandings,
    ...stats,
    teammateQualifying: m.teammateQualifying(races),
  };

  const report = {
    season,
    generatedAt: seasonData.generatedAt,
    racesProcessed: races.length,
    lapRounds: Object.keys(lapData).map(Number),
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warn').length,
    pointsCheck: { checked: checks.length, matched: checks.filter((c) => c.ok).length },
    issues,
  };

  return { seasonData, lapData, report };
}

module.exports = { processSeason };
