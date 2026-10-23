'use strict';
/* global Teams */
// The hero's data line and its small grid-to-flag chart, drawn from the latest processed race.
// app.js announces each loaded season with a "f1:season" event. The chart is a preview: the Race tab holds
// the same figures in a table, and the chart's label says so.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 300;
  const H = 330;
  const PAD_X = 22;
  const PAD_Y = 14;

  const svgEl = (name, attrs) => {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };

  function draw(season, data) {
    const race = data.races.at(-1);
    const now = document.getElementById('heroNow');
    const card = document.getElementById('heroSlope');
    const svg = document.getElementById('heroSlopeSvg');
    if (!race || !now || !card || !svg) return;

    const winner = race.results.find((r) => r.position === 1 && r.classified);
    const name = (id) => data.drivers[id]?.name || id;
    now.hidden = false;
    now.replaceChildren();
    now.append('Latest processed race: ');
    const strong = document.createElement('strong');
    strong.textContent = `${race.name}, ${season}`;
    now.append(strong);
    if (winner) now.append(`. Won by ${name(winner.driverId)}.`);

    const rows = race.results.filter((r) => r.grid !== null && r.grid !== undefined);
    if (rows.length < 2) { card.hidden = true; return; }
    const n = rows.length;
    const y = (pos) => PAD_Y + ((Math.min(pos, n) - 1) * (H - 2 * PAD_Y)) / (n - 1);
    svg.replaceChildren();
    // Back to front: places lost, unchanged, then gained, so the gains sit on top
    const sorted = [...rows].sort((a, b) => ((a.grid || n) - a.position) - ((b.grid || n) - b.position));
    sorted.forEach((r, i) => {
      const from = r.grid || n;
      const colour = Teams.colour(r.constructorId) || '#9b9ba2';
      const delay = `${1200 + i * 38}ms`;
      const line = svgEl('path', {
        class: 'hs-line', d: `M${PAD_X} ${y(from)} L${W - PAD_X} ${y(r.position)}`, pathLength: 1,
        stroke: colour, 'stroke-width': r.classified ? 2.2 : 1.4, 'stroke-opacity': r.classified ? 0.95 : 0.5,
        ...(r.classified ? {} : { 'stroke-dasharray': '3 3' }),
      });
      line.style.setProperty('animation-delay', delay);
      svg.append(line);
      for (const [x, pos] of [[PAD_X, from], [W - PAD_X, r.position]]) {
        const dot = svgEl('circle', { class: 'hs-dot', cx: x, cy: y(pos), r: 2.4, fill: colour });
        dot.style.setProperty('animation-delay', `${2000 + i * 20}ms`);
        svg.append(dot);
      }
    });
    document.getElementById('heroSlopeCap').textContent = `${race.name}: each line runs from the starting grid (left) to the finish (right). Team colours.`;
    card.hidden = false;
  }

  // The band's running line: the season's size in figures, set twice so it can loop without a seam
  function band(season, data) {
    const run = document.getElementById('bandRun');
    if (!run) return;
    const items = [
      `${data.races.length} ${data.races.length === 1 ? 'race' : 'races'}`,
      `${data.driverStats.length} drivers`,
      `${data.constructorStandings.length} teams`,
      `${season} season`,
    ];
    run.replaceChildren();
    for (let copy = 0; copy < 4; copy++) {
      items.forEach((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        run.append(span, document.createElement('i'));
      });
    }
    const sr = document.getElementById('bandText');
    if (sr) sr.textContent = items.join(', ');
  }

  // The closing picture: the top five drivers' championship points by round, one line each in the team colour
  function footer(season, data) {
    const svg = document.getElementById('footLines');
    if (!svg) return;
    const rounds = data.progression.rounds.length;
    const top = data.driverStats.slice(0, 5).map((s) => s.driverId);
    const series = top.map((id) => data.progression.drivers[id]);
    const max = Math.max(1, ...series.flat().filter((v) => v !== null && v !== undefined));
    const X = (i) => 6 + (i * 1188) / Math.max(1, rounds - 1);
    const Y = (v) => 250 - (v / max) * 236;
    svg.replaceChildren();
    const seen = new Set();
    top.forEach((id, k) => {
      const team = data.driverStandings.find((r) => r.driverId === id)?.constructorId;
      const second = seen.has(team);
      seen.add(team);
      let d = '';
      series[k].forEach((v, i) => { if (v !== null && v !== undefined) d += `${d ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; });
      const path = svgEl('path', { class: 'fl-line', d, pathLength: 1, stroke: Teams.colour(team) || '#9b9ba2', 'stroke-opacity': second ? 0.55 : 1 });
      path.style.setProperty('transition-delay', `${k * 160}ms`);
      svg.append(path);
    });
    const names = top.map((id) => data.drivers[id]?.name || id);
    document.getElementById('footCap').textContent = `${season} championship points by round: ${names.join(', ')}.`;
  }

  document.addEventListener('f1:season', (e) => {
    for (const fn of [draw, band, footer]) {
      try { fn(e.detail.season, e.detail.data); } catch (err) { console.error(err); }
    }
  });
})();
