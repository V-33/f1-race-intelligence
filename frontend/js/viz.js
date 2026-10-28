'use strict';
/* global gsap, Charts, Teams */
// Animated visualisations built from the season data: the championship race (bars that re-rank round by
// round), the race replay (running order lap by lap), the season heatmap, the driver profile numbers for the
// radar chart and the progress rings. Everything is drawn from the same data as the tables beside it, and each
// piece says so in its label. Colours and sizes that change at run time go through the CSSOM or SVG attributes,
// because the Content-Security-Policy blocks style attributes written in markup.
const Viz = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animated = () => Boolean(window.gsap) && !calm();
  const motionOn = () => document.documentElement.classList.contains('motion');
  const svgEl = (name, attrs = {}) => {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };

  // Runs fn once when el first comes into view (also works for elements on a tab that is not open yet)
  function whenVisible(el, fn, threshold = 0.35) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fn();
    }, { threshold });
    io.observe(el);
  }

  // ---------- championship race ----------
  const ROW = 36;
  const bars = { rows: [], series: [], max: 1, idx: 0, playing: false, call: null, data: null, name: null, wired: false, autoplayed: false, ctx: null };

  const fillForward = (arr) => {
    let last = 0;
    return arr.map((v) => { if (v !== null && v !== undefined) last = v; return last; });
  };

  function barsRank(i) {
    return bars.rows.map((_, k) => k).sort((a, b) => (bars.series[b][i] - bars.series[a][i]) || (a - b));
  }

  function barsRender(i, animate) {
    const dur = animate && animated() ? 0.75 : 0;
    const order = barsRank(i);
    order.forEach((k, rank) => {
      const row = bars.rows[k];
      const points = bars.series[k][i];
      if (window.gsap) {
        gsap.to(row.el, { y: rank * ROW, duration: dur, ease: 'power3.inOut', overwrite: true });
        gsap.to(row.fill, { scaleX: points / bars.max, duration: dur, ease: 'power3.inOut', overwrite: true });
        gsap.to(row.state, { v: points, duration: dur, ease: 'power3.inOut', overwrite: true, onUpdate: () => { row.val.textContent = String(Math.round(row.state.v)); } });
      } else {
        row.el.style.setProperty('transform', `translateY(${rank * ROW}px)`);
        row.fill.style.setProperty('transform', `scaleX(${points / bars.max})`);
        row.val.textContent = String(points);
      }
      row.el.setAttribute('data-rank', String(rank + 1));
    });
    const d = bars.data;
    const round = d.progression.rounds[i];
    const race = d.races.find((r) => r.round === round);
    $('barsLabel').textContent = `After round ${round}${race ? ` · ${race.name.replace(' Grand Prix', '')}` : ''}`;
    $('barsRound').value = String(i + 1);
  }

  function barsAnnounce() {
    const lead = barsRank(bars.idx)[0];
    const round = bars.data.progression.rounds[bars.idx];
    $('barsLive').textContent = `After round ${round}, ${bars.rows[lead].label} leads with ${bars.series[lead][bars.idx]} points.`;
  }

  function barsStop() {
    bars.playing = false;
    bars.call?.kill();
    $('barsPlay').textContent = 'Play';
    $('barsPlay').setAttribute('aria-pressed', 'false');
  }

  function barsStep() {
    if (!bars.playing) return;
    if (bars.idx >= bars.series[0].length - 1) { barsStop(); barsAnnounce(); return; }
    bars.idx += 1;
    barsRender(bars.idx, true);
    bars.call = window.gsap.delayedCall(0.95, barsStep);
  }

  function barsPlay() {
    if (!window.gsap || bars.playing) return;
    if (bars.idx >= bars.series[0].length - 1) { bars.idx = 0; barsRender(0, false); }
    bars.playing = true;
    $('barsPlay').textContent = 'Pause';
    $('barsPlay').setAttribute('aria-pressed', 'true');
    bars.call = window.gsap.delayedCall(0.4, barsStep);
  }

  function raceBars({ data, name, teamOf }) {
    const el = $('raceBars');
    barsStop();
    bars.data = data;
    const top = data.driverStandings.slice(0, 10);
    bars.series = top.map((r) => fillForward(data.progression.drivers[r.driverId] || []));
    const count = data.progression.rounds.length;
    if (!count || !top.length) { el.replaceChildren(); return; }
    bars.max = Math.max(1, ...bars.series.flat());
    el.replaceChildren();
    el.style.setProperty('height', `${top.length * ROW}px`);
    const seen = new Set();
    bars.rows = top.map((r) => {
      const team = teamOf(r.driverId) || r.constructorId;
      const second = seen.has(team);
      seen.add(team);
      const row = document.createElement('div');
      row.className = `rb-row${second ? ' second' : ''}`;
      row.style.setProperty('--team', Teams.colour(team) || 'var(--muted)');
      const label = name(r.driverId);
      const nameEl = document.createElement('span');
      nameEl.className = 'rb-name';
      nameEl.textContent = label;
      const track = document.createElement('span');
      track.className = 'rb-track';
      const fill = document.createElement('span');
      fill.className = 'rb-fill';
      track.append(fill);
      const val = document.createElement('span');
      val.className = 'rb-val';
      row.append(nameEl, track, val);
      el.append(row);
      return { el: row, fill, val, label, state: { v: 0 } };
    });
    const slider = $('barsRound');
    slider.max = String(count);
    // With animation the bars wait at round 1 and play once when the card is first seen; otherwise they show the final standings
    const willPlay = animated() && motionOn();
    bars.autoplayed = !willPlay;
    bars.idx = willPlay ? 0 : count - 1;
    barsRender(bars.idx, false);
    $('barsPlay').disabled = !window.gsap;
    if (willPlay) whenVisible($('barsCard'), () => { if (!bars.autoplayed && !bars.playing) { bars.autoplayed = true; barsPlay(); } }, 0.5);

    if (!bars.wired) {
      bars.wired = true;
      $('barsPlay').addEventListener('click', () => {
        if (bars.playing) { barsStop(); barsAnnounce(); } else barsPlay();
      });
      $('barsRound').addEventListener('input', (e) => {
        barsStop();
        bars.autoplayed = true;
        bars.idx = Number(e.target.value) - 1;
        barsRender(bars.idx, true);
        barsAnnounce();
      });
    }
  }

  // ---------- race replay ----------
  const R = { call: null, tween: null, lap: 1, n: 1, key: '', wired: false, set: null, autoplayed: false, live: null };

  // Running order per lap from cumulative lap times. A lap with no recorded time takes the driver's median while the
  // driver is still running; a driver who stops is ranked behind everyone still racing, latest retirement first.
  function positions(race, laps) {
    const ids = race.results.map((r) => r.driverId).filter((id) => laps.drivers[id]);
    const N = laps.totalLaps;
    const grid = new Map(race.results.map((r) => [r.driverId, r.grid || 99]));
    const cum = new Map();
    const lastLap = new Map();
    for (const id of ids) {
      const arr = laps.drivers[id];
      const median = laps.stats[id]?.medianMs || 90000;
      let lastReal = -1;
      arr.forEach((ms, l) => { if (ms !== null && ms !== undefined) lastReal = l; });
      let t = 0;
      const c = [];
      for (let l = 0; l < N; l++) {
        if (l > lastReal) { c.push(null); continue; }
        const ms = arr[l];
        t += ms === null || ms === undefined ? median : ms;
        c.push(t);
      }
      cum.set(id, c);
      lastLap.set(id, lastReal);
    }
    const pos = new Map(ids.map((id) => [id, []]));
    for (let l = 0; l < N; l++) {
      const running = ids.filter((id) => cum.get(id)[l] !== null).sort((a, b) => (cum.get(a)[l] - cum.get(b)[l]) || (grid.get(a) - grid.get(b)));
      const stopped = ids.filter((id) => cum.get(id)[l] === null).sort((a, b) => (lastLap.get(b) - lastLap.get(a)) || (grid.get(a) - grid.get(b)));
      [...running, ...stopped].forEach((id, i) => pos.get(id).push(i + 1));
    }
    return { ids, N, pos };
  }

  function replayRender(f) {
    const S = R.set;
    if (!S) return;
    const lap = Math.min(Math.max(f, 1), S.N);
    const i = Math.min(Math.floor(lap) - 1, S.N - 2);
    const t = S.N > 1 ? lap - 1 - Math.max(0, i) : 0;
    S.clip.setAttribute('width', String(S.x(lap)));
    S.items.forEach((it) => {
      const a = S.pos.get(it.id)[Math.max(0, i)];
      const b = S.pos.get(it.id)[Math.min(S.N - 1, Math.max(0, i) + 1)];
      const y = S.y(a + (b - a) * t);
      it.g.setAttribute('transform', `translate(${S.x(lap)} ${y})`);
    });
    $('replayLabel').textContent = `Lap ${Math.round(lap)} of ${S.N}`;
    $('replayLap').value = String(Math.round(lap));
  }

  function replayAnnounce() {
    const S = R.set;
    if (!S) return;
    const lap = Math.round(R.lap);
    const order = [...S.pos.entries()].map(([id, arr]) => [id, arr[Math.min(S.N, Math.max(1, lap)) - 1]]).sort((a, b) => a[1] - b[1]).slice(0, 3);
    $('replayLive').textContent = `Lap ${lap}: ${order.map(([id], k) => `${['first', 'second', 'third'][k]} ${S.ctx.name(id)}`).join(', ')}.`;
  }

  function replayStop() {
    R.tween?.kill();
    R.tween = null;
    $('replayPlay').textContent = 'Play';
    $('replayPlay').setAttribute('aria-pressed', 'false');
  }

  function replayPlay() {
    const S = R.set;
    if (!S || !window.gsap || R.tween) return;
    if (R.lap >= S.N - 0.01) R.lap = 1;
    const proxy = { f: R.lap };
    $('replayPlay').textContent = 'Pause';
    $('replayPlay').setAttribute('aria-pressed', 'true');
    R.tween = gsap.to(proxy, {
      f: S.N, duration: Math.min(24, Math.max(6, (S.N - R.lap) * 0.14)), ease: 'none',
      onUpdate: () => { R.lap = proxy.f; replayRender(proxy.f); },
      onComplete: () => { R.lap = S.N; replayStop(); replayAnnounce(); },
    });
  }

  function replayHide() {
    replayStop();
    R.set = null;
    $('replayCard').hidden = true;
  }

  function replay({ race, laps, team, ctx }) {
    const card = $('replayCard');
    const svg = $('replaySvg');
    const { ids, N, pos } = positions(race, laps);
    if (ids.length < 2 || N < 2) { replayHide(); return; }
    card.hidden = false;
    replayStop();
    svg.replaceChildren();

    const n = ids.length;
    const ROWH = Math.min(26, 520 / Math.max(1, n - 1));
    const H = 28 + (n - 1) * ROWH + 28;
    const L = 40;
    const Rm = 92;
    const W = 1000;
    const x = (lap) => L + ((lap - 1) / Math.max(1, N - 1)) * (W - L - Rm);
    const y = (p) => 28 + (p - 1) * ROWH;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    const defs = svgEl('defs');
    const clip = svgEl('clipPath', { id: 'rpClip' });
    const rect = svgEl('rect', { x: 0, y: 0, width: x(1), height: H });
    clip.append(rect);
    defs.append(clip);
    svg.append(defs);

    const grid = svgEl('g', { class: 'rp-grid' });
    for (const p of [1, 5, 10, 15, 20]) {
      if (p > n) continue;
      grid.append(svgEl('line', { x1: L, x2: W - Rm, y1: y(p), y2: y(p), class: 'rp-rule' }));
      const label = svgEl('text', { x: L - 10, y: y(p) + 4, 'text-anchor': 'end', class: 'rp-pos' });
      label.textContent = String(p);
      grid.append(label);
    }
    svg.append(grid);

    const lines = svgEl('g', { 'clip-path': 'url(#rpClip)' });
    const markers = svgEl('g');
    const colourOf = (id) => ctx.colour(ctx.teamOf(id)) || '#9b9ba2';
    const seen = new Set();
    const items = ids.map((id) => {
      const t = ctx.teamOf(id);
      const second = seen.has(t);
      seen.add(t);
      const picked = Boolean(team) && t === team;
      const faded = Boolean(team) && !picked;
      const d = pos.get(id).map((p, l) => `${l ? 'L' : 'M'}${x(l + 1).toFixed(1)} ${y(p).toFixed(1)}`).join('');
      lines.append(svgEl('path', {
        d, class: 'rp-line', stroke: colourOf(id), 'stroke-width': picked ? 3.4 : 2.2,
        'stroke-opacity': faded ? 0.18 : second ? 0.6 : 0.95, ...(second ? { 'stroke-dasharray': '5 3' } : {}),
      }));
      const g = svgEl('g', { class: 'rp-mark', opacity: faded ? 0.35 : 1 });
      g.append(svgEl('circle', { r: 4.2, fill: colourOf(id), cx: 0, cy: 0 }));
      const text = svgEl('text', { x: 9, y: 4, class: 'rp-code' });
      text.textContent = ctx.code(id);
      g.append(text);
      markers.append(g);
      return { id, g };
    });
    svg.append(lines, markers);

    R.set = { N, pos, x, y, clip: rect, items, ctx };
    R.n = N;
    const key = `${race.round}:${n}:${N}`;
    const fresh = key !== R.key;
    R.key = key;
    const slider = $('replayLap');
    slider.max = String(N);
    const willPlay = fresh && animated() && motionOn();
    R.lap = willPlay ? 1 : N;
    R.autoplayed = !willPlay;
    replayRender(R.lap);
    $('replayPlay').disabled = !window.gsap;
    if (willPlay) whenVisible(card, () => { if (!R.autoplayed && R.set) { R.autoplayed = true; replayPlay(); } }, 0.4);

    if (!R.wired) {
      R.wired = true;
      $('replayPlay').addEventListener('click', () => {
        if (R.tween) { replayStop(); replayAnnounce(); } else replayPlay();
      });
      $('replayLap').addEventListener('input', (e) => {
        replayStop();
        R.autoplayed = true;
        R.lap = Number(e.target.value);
        replayRender(R.lap);
        replayAnnounce();
      });
    }
  }

  // ---------- season heatmap ----------
  // drivers = [{ id, name, byRace: [{ classified, finish }] }], one cell per round
  function heatmap({ drivers, rounds, colour }) {
    const el = $('heatmap');
    el.replaceChildren();
    el.style.setProperty('--cols', String(rounds.length));
    const corner = document.createElement('span');
    corner.className = 'hm-corner';
    el.append(corner);
    rounds.forEach((r) => {
      const head = document.createElement('span');
      head.className = 'hm-head';
      head.textContent = `R${r}`;
      el.append(head);
    });
    const cells = [];
    drivers.forEach((d) => {
      const name = document.createElement('span');
      name.className = 'hm-name';
      const tick = document.createElement('i');
      tick.className = 'hm-tick';
      tick.style.setProperty('--team', colour(d.id) || 'var(--muted)');
      name.append(tick, d.name);
      el.append(name);
      rounds.forEach((r, i) => {
        const res = d.byRace[i];
        const cell = document.createElement('span');
        cell.className = 'hm-cell';
        if (res && res.classified && res.finish) {
          const v = Math.max(0.08, Math.min(1, (21 - res.finish) / 20));
          cell.style.setProperty('--v', v.toFixed(2));
          if (v > 0.55) cell.classList.add('hi');
          cell.textContent = String(res.finish);
          cell.title = `${d.name}, round ${r}: P${res.finish}`;
        } else {
          cell.classList.add('out');
          cell.textContent = '–';
          cell.title = `${d.name}, round ${r}: did not finish or not entered`;
        }
        el.append(cell);
        cells.push(cell);
      });
    });
    if (window.gsap && animated() && motionOn()) {
      gsap.set(cells, { opacity: 0, scale: 0.4 });
      whenVisible(el, () => gsap.to(cells, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)', stagger: { each: 0.006, from: 'start' }, clearProps: 'opacity,transform' }), 0.25);
    }
  }

  // ---------- driver profile (radar) ----------
  const METRICS = [
    { label: 'Points per start', get: (s) => s.pointsPerStart, fmt: (v) => v.toFixed(1) },
    { label: 'Average finish', get: (s) => s.avgFinish, lower: true, fmt: (v) => `P${v.toFixed(1)}` },
    { label: 'Average qualifying', get: (s) => s.avgQualifying, lower: true, fmt: (v) => `P${v.toFixed(1)}` },
    { label: 'Places gained per race', get: (s) => s.avgPositionsGained, fmt: (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)) },
    { label: 'Podium rate', get: (s) => (s.starts ? s.podiums / s.starts : null), fmt: (v) => `${Math.round(v * 100)}%` },
    { label: 'Win rate', get: (s) => (s.starts ? s.wins / s.starts : null), fmt: (v) => `${Math.round(v * 100)}%` },
  ];

  // Scales each metric 0 to 1 against every driver with at least five starts; lower-is-better metrics are flipped
  function profile(allStats, picks) {
    const pool = allStats.filter((s) => s.starts >= 5);
    const range = METRICS.map((m) => {
      const values = pool.map((s) => m.get(s)).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
      return { min: Math.min(...values), max: Math.max(...values) };
    });
    const scale = (m, r, v) => {
      if (v === null || v === undefined || Number.isNaN(v) || r.max === r.min) return 0;
      const t = (v - r.min) / (r.max - r.min);
      return Math.max(0, Math.min(1, m.lower ? 1 - t : t));
    };
    return {
      labels: METRICS.map((m) => m.label),
      sets: picks.map((s) => ({
        id: s.driverId,
        data: METRICS.map((m, i) => scale(m, range[i], m.get(s))),
        raw: METRICS.map((m) => { const v = m.get(s); return v === null || v === undefined || Number.isNaN(v) ? 'no data' : m.fmt(v); }),
      })),
    };
  }

  // ---------- progress rings ----------
  // Rings are drawn at their final fraction and, where animation is welcome, drawn in when first seen.
  function rings(scope) {
    scope.querySelectorAll('.ring-fg').forEach((fg) => {
      const frac = Number(fg.dataset.frac);
      fg.setAttribute('stroke-dasharray', `${(frac * 100).toFixed(1)} 100`);
      if (window.gsap && animated() && motionOn()) {
        fg.setAttribute('stroke-dasharray', '0 100');
        whenVisible(fg.closest('.tile') || fg, () => gsap.to(fg, { attr: { 'stroke-dasharray': `${(frac * 100).toFixed(1)} 100` }, duration: 1.2, ease: 'power3.out' }), 0.4);
      }
    });
  }

  return { raceBars, replay, replayHide, heatmap, profile, rings, whenVisible };
})();
