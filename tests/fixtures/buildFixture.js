'use strict';
// Builds a SMALL SYNTHETIC season in Jolpica/Ergast raw format for automated tests.
// The drivers, teams and times are made up. It is not real F1 data.

const DRIVERS = [
  ['alpha', 'ALP', 'Ann', 'Alpha', 'red_team'], ['bravo', 'BRA', 'Ben', 'Bravo', 'red_team'],
  ['charlie', 'CHA', 'Cal', 'Charlie', 'blue_team'], ['delta', 'DEL', 'Dee', 'Delta', 'blue_team'],
  ['echo', 'ECH', 'Eli', 'Echo', 'green_team'], ['foxtrot', 'FOX', 'Fay', 'Foxtrot', 'green_team'],
];
const TEAMS = { red_team: 'Red Team', blue_team: 'Blue Team', green_team: 'Green Team' };
const POINTS = [25, 18, 15, 12, 10, 8];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3];

const driver = ([driverId, code, givenName, familyName]) => ({ driverId, code, givenName, familyName, nationality: 'Testland', permanentNumber: '1' });
const team = (id) => ({ constructorId: id, name: TEAMS[id], nationality: 'Testland' });
const lap = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

// finishing order per round (index into DRIVERS); grid order per round
const ORDERS = [[0, 2, 1, 3, 4, 5], [2, 0, 3, 1, 5, 4], [1, 0, 2, 4, 3, 5]];
const GRIDS = [[2, 0, 1, 4, 3, 5], [0, 2, 1, 3, 4, 5], [1, 0, 3, 2, 5, 4]];

function build() {
  const races = ORDERS.map((_, i) => ({
    season: '2099', round: String(i + 1), raceName: `Test ${i + 1} Grand Prix`, date: `2099-0${i + 3}-01`,
    Circuit: { circuitId: `track_${i + 1}`, circuitName: `Track ${i + 1}`, Location: { locality: 'Town', country: 'Testland' } },
  }));
  const totals = {};
  const results = races.map((race, i) => ({
    ...race,
    Results: ORDERS[i].map((d, pos) => {
      const dnf = i === 2 && pos === 5; // last car in round 3 retires
      const pts = dnf ? 0 : POINTS[pos];
      totals[DRIVERS[d][0]] = (totals[DRIVERS[d][0]] || 0) + pts;
      return {
        position: String(pos + 1), positionText: dnf ? 'R' : String(pos + 1), points: String(pts),
        Driver: driver(DRIVERS[d]), Constructor: team(DRIVERS[d][4]),
        grid: String(GRIDS[i].indexOf(d) + 1), laps: dnf ? '20' : '50', status: dnf ? 'Engine' : 'Finished',
        Time: dnf ? undefined : { millis: String(5400000 + pos * 1000) },
        FastestLap: { rank: String(pos + 1), Time: { time: lap(90000 + pos * 150) } },
      };
    }),
  }));
  // inject a duplicate row to exercise validation
  results[0].Results.push({ ...results[0].Results[0] });

  const qualifying = races.map((race, i) => ({
    ...race,
    QualifyingResults: GRIDS[i].map((d, pos) => ({
      position: String(pos + 1), Driver: driver(DRIVERS[d]), Constructor: team(DRIVERS[d][4]),
      Q1: lap(89000 + pos * 200), Q2: pos < 4 ? lap(88800 + pos * 200) : '', Q3: pos < 2 ? lap(88500 + pos * 200) : '',
    })),
  }));

  const sprint = [{
    ...races[1],
    SprintResults: ORDERS[1].map((d, pos) => {
      totals[DRIVERS[d][0]] += SPRINT_POINTS[pos];
      return { position: String(pos + 1), positionText: String(pos + 1), points: String(SPRINT_POINTS[pos]),
        Driver: driver(DRIVERS[d]), Constructor: team(DRIVERS[d][4]), grid: String(pos + 1), laps: '17', status: 'Finished' };
    }),
  }];

  const ranking = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const driverstandings = [{ season: '2099', round: '3', DriverStandings: ranking.map(([id, pts], i) => {
    const d = DRIVERS.find((x) => x[0] === id);
    return { position: String(i + 1), points: String(pts), wins: '0', Driver: driver(d), Constructors: [team(d[4])] };
  }) }];
  const teamPts = {};
  for (const [id, pts] of ranking) { const t = DRIVERS.find((x) => x[0] === id)[4]; teamPts[t] = (teamPts[t] || 0) + pts; }
  const constructorstandings = [{ season: '2099', round: '3', ConstructorStandings: Object.entries(teamPts)
    .sort((a, b) => b[1] - a[1]).map(([id, pts], i) => ({ position: String(i + 1), points: String(pts), wins: '0', Constructor: team(id) })) }];

  // 10 laps for round 1; lap 5 is a slow pit lap for alpha; one invalid time for bravo
  const laps = { 1: { ...races[0], Laps: Array.from({ length: 10 }, (_, n) => ({
    number: String(n + 1),
    Timings: DRIVERS.map(([id], k) => ({ driverId: id, position: String(k + 1),
      time: id === 'bravo' && n === 3 ? 'bad' : lap(92000 + k * 300 + (n % 3) * 100 + (id === 'alpha' && n === 4 ? 20000 : 0)) })),
  })) } };

  return { races, results, qualifying, sprint, driverstandings, constructorstandings, laps, totals };
}

module.exports = { build };
