'use strict';
/* global Api, Charts, Teams, Motion, Viz */

const state = { season: null, data: null, round: null, laps: null, colorSlots: new Map() };
const $ = (id) => document.getElementById(id);

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const driverName = (id) => state.data.drivers[id]?.name || id;
const driverCode = (id) => state.data.drivers[id]?.code || id;
const teamName = (id) => state.data.constructors[id]?.name || id;
const fmtNum = (n, d = 2) => (n === null || n === undefined ? '–' : Number(n).toFixed(d).replace(/\.?0+$/, '') || '0');
// Chart x labels are short ("R7"); the full race name goes in the tooltip.
const raceLabels = () => state.data.races.map((r) => `R${r.round}`);
const raceTitles = () => state.data.races.map((r) => `Round ${r.round} · ${r.name}`);
const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

function fmtLap(ms) {
  if (!ms) return '–';
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return m ? `${m}:${s}` : s;
}

// A failed load can offer a retry that runs the same action again
let retryAction = null;
function setStatus(msg, isError = false, retry = null) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
  $('status').setAttribute('role', isError ? 'alert' : 'status');
  retryAction = isError ? retry : null;
  $('retry').hidden = !retryAction;
}

// columns: { label, value | html, num?, muted?, hideSm? } (hideSm columns drop out on narrow screens)
function table(el, columns, rows) {
  const cls = (c) => [c.num && 'num', c.muted && 'muted', c.hideSm && 'hide-sm'].filter(Boolean).join(' ');
  const head = columns.map((c) => `<th class="${[c.num && 'num', c.hideSm && 'hide-sm'].filter(Boolean).join(' ')}">${esc(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${columns.map((c) => `<td class="${cls(c)}">${c.html ? c.html(r) : esc(c.value(r))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="muted">No data</td></tr>`;
  el.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  paintTeams(el);
}

// A small team-coloured marker before a name. The colour is set through the CSSOM, because the
// Content-Security-Policy blocks style attributes written in markup.
const teamTick = (constructorId) => `<span class="team-tick" data-team="${esc(constructorId)}"></span>`;
function paintTeams(root) {
  root.querySelectorAll('.team-tick').forEach((el) => {
    el.style.setProperty('--team', Teams.colour(el.dataset.team) || 'var(--muted)');
  });
}

// items: { label, value, unit?, detail?, lead? }. The lead figure is the answer to the screen's question.
function tiles(el, items) {
  el.classList.toggle('has-lead', items.some((t) => t.lead));
  el.innerHTML = items.map((t) => `<div class="tile${t.lead ? ' lead' : ''}"><div class="label">${esc(t.label)}</div>` +
    `<div class="value">${esc(t.value)}${t.unit ? `<span class="unit"> ${esc(t.unit)}</span>` : ''}</div>` +
    `${t.detail ? `<div class="detail">${esc(t.detail)}</div>` : ''}${ringMarkup(t.ring)}</div>`).join('');
  Motion.countTiles(el);
  Viz.rings(el);
}

// A thin progress ring for a figure that is a share of something (0 to 1)
const ringMarkup = (frac) => (typeof frac === 'number' && frac >= 0
  ? `<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-bg" cx="18" cy="18" r="15.9155" pathLength="100"/><circle class="ring-fg" cx="18" cy="18" r="15.9155" pathLength="100" data-frac="${Math.min(1, frac)}"/></svg>`
  : '');

// Everything the visualisations need to name drivers and teams from the season in view
const vizContext = () => ({
  name: driverName,
  code: driverCode,
  teamOf: (id) => state.data.driverStandings.find((r) => r.driverId === id)?.constructorId,
  colour: (team) => Teams.colour(team),
});

// The line under the page title: the data source by default, a finding on the Overview.
const setPageLine = (text) => { $('dataSource').textContent = text; };

function fillSelect(el, options, { keep = true, placeholder } = {}) {
  const prev = el.multiple ? [...el.selectedOptions].map((o) => o.value) : el.value;
  el.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
    options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if (keep) {
    if (el.multiple) [...el.options].forEach((o) => { o.selected = prev.includes(o.value); });
    else if (options.some((o) => o.value === prev)) el.value = prev;
  }
}

const selected = (el) => [...el.selectedOptions].map((o) => o.value).filter(Boolean);

// Keep a driver's color fixed while they stay selected, so a filter never repaints survivors.
function colorFor(ids) {
  for (const id of [...state.colorSlots.keys()]) if (!ids.includes(id)) state.colorSlots.delete(id);
  for (const id of ids) {
    if (state.colorSlots.has(id)) continue;
    const used = new Set(state.colorSlots.values());
    let slot = 0;
    while (used.has(slot)) slot++;
    state.colorSlots.set(id, slot);
  }
  return (id) => state.colorSlots.get(id);
}

// Limit a multi-select to `max` choices.
function capSelection(el, max) {
  const chosen = [...el.selectedOptions];
  chosen.slice(max).forEach((o) => { o.selected = false; });
}

// ---------- tabs ----------
const TAB_TITLES = { overview: 'Overview', race: 'Race', drivers: 'Driver comparison', constructors: 'Constructors', quality: 'Data quality' };

// Selected tab and its panel; only the selected tab is in the tab order (arrow keys move between tabs).
function markTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  $('pageTitle').textContent = TAB_TITLES[name] || name;
  $('overviewActions').hidden = name !== 'overview';
  $('raceControls').hidden = name !== 'race';
  $('raceClip').hidden = name !== 'race';
  if (state.data) setPageLine(`${state.season} season · ${state.data.source}`);
  Motion.tabInk();
  Motion.refresh();
}

function showTab(name) {
  markTab(name);
  try { localStorage.setItem('f1.tab', name); } catch { /* storage may be blocked */ }
  return renderTab(name);
}

function onTabKey(e) {
  const tabs = [...document.querySelectorAll('.tabs button')];
  const i = tabs.indexOf(document.activeElement);
  const next = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
  if (i < 0 || next === undefined) return;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

// ---------- theme ----------
// theme.js sets data-theme before first paint. A saved choice wins over the system setting.
const savedTheme = () => { try { return localStorage.getItem('f1.theme'); } catch { return null; } };

function setTheme(theme, persist) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) { try { localStorage.setItem('f1.theme', theme); } catch { /* storage may be blocked */ } }
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  $('themeToggle').setAttribute('aria-label', label);
  $('themeToggle').title = label;
  // Charts take their colours from the CSS variables when drawn, so draw the open tab again
  guard(() => renderTab(currentTab()))();
}
const currentTab = () => document.querySelector('.tabs button[aria-selected="true"]').dataset.tab;

function renderTab(name) {
  if (!state.data) return;
  ({ overview: renderOverview, race: renderRace, drivers: renderDrivers, constructors: renderConstructors, quality: renderQuality })[name]();
}

// ---------- overview ----------
const DRIVER_ROWS_SHOWN = 10;
const overview = { view: 'points', allDrivers: false };

// Points behind the leader, shown as a negative number: 0 is the line to be on, lower is further back.
const gap = (ahead, behind) => (behind.points === ahead.points ? '–' : `−${ahead.points - behind.points}`);

function renderOverview() {
  const d = state.data;
  const [leader, second] = d.driverStandings;
  const [team, team2] = d.constructorStandings;
  const round = d.standingsAfterRound ?? d.races.at(-1)?.round;

  // The finding, computed from the standings as shown
  const lines = [];
  if (leader && second) lines.push(`${driverName(leader.driverId)} leads ${driverName(second.driverId)} by ${leader.points - second.points} pts`);
  if (team && team2) lines.push(`${teamName(team.constructorId)} leads ${teamName(team2.constructorId)} by ${team.points - team2.points} pts`);
  setPageLine(lines.length ? `${lines.join(' · ')} after round ${round}` : `${state.season} season · ${d.source}`);
  const latest = d.races.at(-1);
  $('latestRace').textContent = latest ? `Latest race: ${latest.name}` : '';
  $('latestRace').hidden = !latest;

  const mostWins = [...d.driverStats].sort((a, b) => b.wins - a.wins)[0];
  const mostGained = [...d.driverStats].filter((x) => x.starts >= 5).sort((a, b) => b.avgPositionsGained - a.avgPositionsGained)[0];
  tiles($('overviewTiles'), [
    leader && second && { lead: true, label: 'Drivers’ championship lead', value: leader.points - second.points, unit: 'pts',
      detail: `${driverName(leader.driverId)} over ${driverName(second.driverId)}` },
    team && team2 && { label: 'Constructors’ lead', value: team.points - team2.points, unit: 'pts',
      detail: `${teamName(team.constructorId)} over ${teamName(team2.constructorId)}` },
    mostWins && { label: 'Most wins', value: mostWins.wins, unit: mostWins.wins === 1 ? 'win' : 'wins', detail: driverName(mostWins.driverId) },
    mostGained && { label: 'Most positions gained', value: signed(Math.round(mostGained.avgPositionsGained * 100) / 100), unit: 'per race',
      detail: `${driverName(mostGained.driverId)}, from ${mostGained.starts} starts` },
    { label: 'Races processed', value: d.races.length, detail: `Standings after round ${round ?? '–'}` },
  ].filter(Boolean));

  renderProgression();
  renderStandings();
  Viz.raceBars({ data: d, name: driverName, teamOf: vizContext().teamOf });
}

// Lines take their team's colour; a team's second driver is dashed so teammates never rely on colour alone.
function renderProgression() {
  const d = state.data;
  const asGap = overview.view === 'gap';
  document.querySelectorAll('#tab-overview .seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === overview.view)));
  $('progressionHint').textContent = asGap
    ? 'Points behind the championship leader after each round. Zero means leading.'
    : 'Top five drivers. Includes sprint points. A team’s second driver is dashed.';

  const all = Object.values(d.progression.drivers);
  const leaderAfter = d.progression.rounds.map((_, i) => Math.max(...all.map((s) => s[i] ?? 0)));
  const top = d.driverStats.slice(0, 5).map((s) => s.driverId);
  const teamOf = (id) => d.driverStandings.find((r) => r.driverId === id)?.constructorId;
  const seenTeams = new Set();
  Charts.lines('progressionChart', raceLabels(), top.map((id, i) => {
    const t = teamOf(id);
    const color = Teams.colour(t) || undefined;
    const dashed = Boolean(color) && seenTeams.has(t);
    seenTeams.add(t);
    const points = d.progression.drivers[id];
    return { label: driverName(id), short: driverCode(id), color, colorIndex: i, dashed,
      data: asGap ? points.map((p, k) => (p === null || p === undefined ? null : p - leaderAfter[k])) : points };
  }), { yTitle: asGap ? 'Points behind leader' : 'Points', tooltipSuffix: ' pts', titles: raceTitles(), integerY: asGap });
}

function renderStandings() {
  const d = state.data;
  const drivers = overview.allDrivers ? d.driverStandings : d.driverStandings.slice(0, DRIVER_ROWS_SHOWN);
  const lead = d.driverStandings[0];
  const teamLead = d.constructorStandings[0];
  const hasMore = d.driverStandings.length > DRIVER_ROWS_SHOWN;
  const toggle = $('driversToggle');
  toggle.hidden = !hasMore;
  toggle.textContent = overview.allDrivers ? 'Show top 10' : `View all ${d.driverStandings.length}`;
  toggle.setAttribute('aria-expanded', String(overview.allDrivers));
  $('standingsGrid').classList.toggle('expanded', overview.allDrivers);

  table($('driverStandings'), [
    { label: 'Pos', num: true, value: (r) => r.position },
    { label: 'Driver', html: (r) => `${teamTick(r.constructorId)}${esc(driverName(r.driverId))}` },
    { label: 'Team', muted: true, hideSm: true, value: (r) => teamName(r.constructorId) },
    { label: 'Wins', num: true, muted: true, hideSm: true, value: (r) => r.wins },
    { label: 'Gap', num: true, muted: true, value: (r) => (r === lead ? '–' : gap(lead, r)) },
    { label: 'Points', num: true, value: (r) => r.points },
  ], drivers);
  table($('constructorStandings'), [
    { label: 'Pos', num: true, value: (r) => r.position },
    { label: 'Constructor', html: (r) => `${teamTick(r.constructorId)}${esc(teamName(r.constructorId))}` },
    { label: 'Wins', num: true, muted: true, value: (r) => r.wins },
    { label: 'Gap', num: true, muted: true, value: (r) => (r === teamLead ? '–' : gap(teamLead, r)) },
    { label: 'Points', num: true, value: (r) => r.points },
  ], d.constructorStandings);
}

// ---------- race ----------
async function renderRace() {
  const d = state.data;
  const race = d.races.find((r) => r.round === Number($('raceSelect').value)) || d.races.at(-1);
  if (!race) return;
  const team = $('raceTeamFilter').value;
  const keep = (row) => !team || row.constructorId === team;
  const results = race.results.filter(keep);
  const winner = race.results[0];
  const pole = race.qualifying[0];
  const fastest = race.results.find((r) => r.fastestLapRank === 1);
  const gained = race.results.filter((r) => r.classified && r.grid).sort((a, b) => (b.grid - b.position) - (a.grid - a.position))[0];
  const gainedBy = gained ? gained.grid - gained.position : 0;
  const startText = (r) => (r.pitLaneStart ? 'from the pit lane' : r.grid === 1 ? 'from pole' : r.grid ? `from P${r.grid}` : '');
  $('tab-race').classList.toggle('filtered', Boolean(team));

  // The finding under the title: how Sunday went compared with the grid
  const notClassified = race.results.filter((r) => !r.classified).length;
  setPageLine([
    winner && `${driverName(winner.driverId)} won ${startText(winner)}`.trim(),
    gainedBy > 0 && `${driverName(gained.driverId)} gained the most places (P${gained.grid} → P${gained.position})`,
    notClassified > 0 && `${notClassified} not classified`,
  ].filter(Boolean).join(' · ') || `${race.name} · ${race.date}`);

  tiles($('raceTiles'), [
    winner && { lead: true, label: 'Winner', value: driverName(winner.driverId), detail: `${teamName(winner.constructorId)} · ${startText(winner) || 'grid unknown'}` },
    pole && { label: 'Pole position', value: driverName(pole.driverId), detail: fmtLap(pole.bestMs) },
    fastest && { label: 'Fastest lap', value: driverName(fastest.driverId), detail: fmtLap(fastest.fastestLapMs) },
    gained && { label: 'Most places gained', value: signed(gainedBy), unit: gainedBy === 1 ? 'place' : 'places', detail: `${driverName(gained.driverId)}, P${gained.grid} → P${gained.position}` },
    { label: `Round ${race.round}`, value: race.name.replace(' Grand Prix', ''), detail: [race.circuit, race.date].filter(Boolean).join(' · ') },
  ].filter(Boolean));

  renderSlope(race, team);

  const gaps = race.qualifyingGaps.filter((g) => g.gapMs !== null && keep(race.qualifying.find((q) => q.driverId === g.driverId) || {}));
  Charts.hbars('qualiGapChart', gaps.map((g) => `P${g.position} ${driverCode(g.driverId)}`), gaps.map((g) => g.gapMs / 1000),
    { valueLabel: 'Gap (s)', tooltipFormat: (v) => `+${v.toFixed(3)} s`, format: (v) => (v ? `+${v.toFixed(3)}` : '') });

  const moved = results.filter((r) => r.classified && r.grid);
  Charts.hbars('positionsChart', moved.map((r) => `P${r.position} ${driverCode(r.driverId)}`), moved.map((r) => r.grid - r.position), {
    colors: moved.map((r) => (r.grid - r.position >= 0 ? Charts.css('--positive') : Charts.css('--negative'))),
    tooltipFormat: (v) => (v > 0 ? `Gained ${v}` : v < 0 ? `Lost ${-v}` : 'No change'),
    format: signed,
  });

  table($('raceResults'), [
    { label: 'Pos', num: true, value: (r) => (r.classified ? r.position : r.positionText) },
    { label: 'Driver', html: (r) => `${teamTick(r.constructorId)}${esc(driverName(r.driverId))}` },
    { label: 'Team', muted: true, hideSm: true, value: (r) => teamName(r.constructorId) },
    { label: 'Grid', num: true, muted: true, hideSm: true, value: (r) => (r.pitLaneStart ? 'Pit lane' : r.grid) },
    { label: '+/-', num: true, html: (r) => {
      if (!r.classified || !r.grid) return '<span class="muted">–</span>';
      const v = r.grid - r.position;
      return `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}">${signed(v)}</span>`;
    } },
    { label: 'Points', num: true, value: (r) => r.points },
    { label: 'Status', muted: true, hideSm: true, value: (r) => r.status },
  ], results);

  table($('qualiResults'), [
    { label: 'Pos', num: true, value: (q) => q.position },
    { label: 'Driver', html: (q) => `${teamTick(q.constructorId)}${esc(driverName(q.driverId))}` },
    { label: 'Q1', num: true, muted: true, hideSm: true, value: (q) => fmtLap(q.q1Ms) },
    { label: 'Q2', num: true, muted: true, hideSm: true, value: (q) => fmtLap(q.q2Ms) },
    { label: 'Q3', num: true, value: (q) => fmtLap(q.q3Ms) },
    { label: 'Gap', num: true, value: (q) => { const g = race.qualifyingGaps.find((x) => x.driverId === q.driverId); return g?.gapMs ? `+${(g.gapMs / 1000).toFixed(3)}` : (g?.gapMs === 0 ? '–' : ''); } },
  ], race.qualifying.filter(keep));

  await renderLaps(race);
}

// Grid to flag: one line per driver from the starting grid to the finish. Gained places are green, lost places red,
// unchanged grey; a dashed line did not finish. With a constructor selected its drivers are drawn in the team colour
// and the rest fade, so the field stays in view.
function renderSlope(race, team) {
  const n = race.results.length;
  const rows = race.results.filter((r) => r.grid !== null && r.grid !== undefined).map((r) => {
    const from = r.grid || n; // a pit-lane start goes to the back of the grid
    const delta = from - r.position;
    const polarity = Charts.css(delta > 0 ? '--positive' : delta < 0 ? '--negative' : '--text-muted');
    const picked = Boolean(team) && r.constructorId === team;
    const faded = Boolean(team) && !picked;
    const colour = picked ? Teams.colour(team) || polarity : polarity;
    const code = driverCode(r.driverId);
    const finish = r.classified ? r.position : r.positionText;
    return {
      label: driverName(r.driverId),
      from,
      to: r.position,
      left: `${code} ${r.pitLaneStart ? 'PL' : r.grid}`,
      right: `${finish} ${code}`,
      tip: r.classified ? `${r.pitLaneStart ? 'Pit lane' : `P${r.grid}`} → P${r.position} (${signed(delta)})` : `${r.pitLaneStart ? 'Pit lane' : `P${r.grid}`} → ${r.status}`,
      color: faded ? Charts.fade(colour, 0.22) : colour,
      textColor: faded ? Charts.css('--text-muted') : Charts.css('--text'),
      width: picked ? 3 : 2,
      dashed: !r.classified,
      top: picked,
    };
  });
  $('slopeHint').textContent = team
    ? `${teamName(team)} highlighted. Each line runs from the starting grid to the finish; dashed lines did not finish.`
    : 'Each line runs from the starting grid to the finish. Green gained places, red lost them, dashed lines did not finish.';
  Charts.slope('slopeChart', rows, { positions: n });
}

async function renderLaps(race) {
  const card = $('lapCard');
  card.classList.toggle('empty', !race.hasLaps);
  $('raceRowC').classList.toggle('no-laps', !race.hasLaps);
  if (!race.hasLaps) {
    $('lapStats').innerHTML = '<p class="muted">No lap data has been processed for this race. Run the ingest script with <code>--laps</code> for this round, then process the season again.</p>';
    Charts.clear('lapChart');
    $('lapDrivers').innerHTML = '';
    Viz.replayHide();
    return;
  }
  if (!state.laps || state.laps.round !== race.round || state.laps.season !== state.season) {
    state.laps = await Api.laps(state.season, race.round);
  }
  const laps = state.laps;
  Viz.replay({ race, laps, team: $('raceTeamFilter').value, ctx: { ...vizContext(), teamOf: (id) => race.results.find((r) => r.driverId === id)?.constructorId } });
  const sel = $('lapDrivers');
  const order = race.results.map((r) => r.driverId).filter((id) => laps.drivers[id]);
  const before = selected(sel);
  fillSelect(sel, order.map((id) => ({ value: id, label: driverName(id) })));
  if (!before.length || !before.some((id) => laps.drivers[id])) [...sel.options].slice(0, 2).forEach((o) => { o.selected = true; });
  capSelection(sel, 4);
  const ids = selected(sel);
  const color = colorFor(ids);
  const hideSlow = $('lapFilterSlow').checked;
  const labels = Array.from({ length: laps.totalLaps }, (_, i) => i + 1);
  Charts.lines('lapChart', labels, ids.map((id) => {
    const med = laps.stats[id]?.medianMs;
    return {
      label: driverName(id),
      short: driverCode(id),
      colorIndex: color(id),
      data: laps.drivers[id].map((ms) => (ms === null || (hideSlow && med && ms > med * 1.07) ? null : ms / 1000)),
    };
  }), { yTitle: 'Lap time (s)', tooltipSuffix: ' s' });

  table($('lapStats'), [
    { label: 'Driver', html: (id) => `<span class="swatch s${color(id) % 8}"></span>${esc(driverName(id))}` },
    { label: 'Laps', num: true, value: (id) => laps.stats[id].laps },
    { label: 'Fastest', num: true, value: (id) => fmtLap(laps.stats[id].fastestMs) },
    { label: 'Median', num: true, value: (id) => fmtLap(laps.stats[id].medianMs) },
    { label: 'Consistency (std dev)', num: true, value: (id) => (laps.stats[id].consistencyMs === null ? '–' : `${(laps.stats[id].consistencyMs / 1000).toFixed(3)} s`) },
  ], ids);
}

// ---------- drivers ----------
async function renderDrivers() {
  const d = state.data;
  const team = $('driverTeamFilter').value;
  const pool = d.driverStats.filter((s) => !team || s.constructors.includes(team));
  const sel = $('compareDrivers');
  fillSelect(sel, pool.map((s) => ({ value: s.driverId, label: `${driverName(s.driverId)} (${s.constructors.map(teamName).join(', ')})` })));
  if (!selected(sel).length) [...sel.options].slice(0, 2).forEach((o) => { o.selected = true; });
  capSelection(sel, 4);
  const ids = selected(sel);
  if (!ids.length) return;

  const cmp = await Api.compare(state.season, ids);
  const color = colorFor(ids);
  const metrics = [
    ['Championship points', (s) => s.points],
    ['Wins', (s) => s.wins],
    ['Podiums', (s) => s.podiums],
    ['Pole positions', (s) => s.poles],
    ['Races started', (s) => s.starts],
    ['Average finish (classified)', (s) => fmtNum(s.avgFinish)],
    ['Average grid', (s) => fmtNum(s.avgGrid)],
    ['Average qualifying', (s) => fmtNum(s.avgQualifying)],
    ['Average positions gained', (s) => fmtNum(s.avgPositionsGained)],
    ['Best finish', (s) => s.bestFinish ?? '–'],
    ['Retirements / not classified', (s) => s.dnfs],
    ['Fastest laps', (s) => s.fastestLaps],
    ['Points per start', (s) => fmtNum(s.pointsPerStart)],
  ];
  const head = `<tr><th>Metric</th>${cmp.drivers.map((x) => `<th class="num"><span class="swatch s${color(x.id) % 8}"></span>${esc(x.name)}</th>`).join('')}</tr>`;
  const rows = metrics.map(([label, fn]) => `<tr><td>${esc(label)}</td>${cmp.drivers.map((x) => `<td class="num">${esc(x.stats ? fn(x.stats) : '–')}</td>`).join('')}</tr>`).join('');
  $('compareTable').innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;

  Charts.lines('finishChart', raceLabels(), cmp.drivers.map((x) => ({
    label: x.name, short: driverCode(x.id), colorIndex: color(x.id), data: x.byRace.map((r) => (r.classified ? r.finish : null)),
  })), { reverseY: true, yTitle: 'Finishing position', integerY: true, titles: raceTitles() });
  Charts.lines('comparePointsChart', raceLabels(), cmp.drivers.map((x) => ({ label: x.name, short: driverCode(x.id), colorIndex: color(x.id), data: x.progression })),
    { yTitle: 'Points', tooltipSuffix: ' pts', titles: raceTitles() });

  const picks = ids.map((id) => d.driverStats.find((s) => s.driverId === id)).filter(Boolean);
  const prof = Viz.profile(d.driverStats, picks);
  Charts.radar('radarChart', prof.labels, prof.sets.map((s) => ({
    label: driverName(s.id), color: Charts.series(color(s.id)), data: s.data, raw: s.raw,
  })));
  Viz.heatmap({
    drivers: cmp.drivers,
    rounds: d.progression.rounds,
    colour: (id) => Teams.colour(d.driverStandings.find((r) => r.driverId === id)?.constructorId),
  });

  const battles = d.teammateQualifying.filter((t) => !team || t.constructorId === team);
  table($('teammateTable'), [
    { label: 'Constructor', value: (t) => teamName(t.constructorId) },
    { label: 'Drivers', value: (t) => `${driverName(t.drivers[0])} vs ${driverName(t.drivers[1])}` },
    { label: 'Qualifying score', num: true, value: (t) => `${t.wins[0]} – ${t.wins[1]}` },
    { label: 'Median gap', num: true, value: (t) => (t.medianGapMs === null ? '–' : `${(Math.abs(t.medianGapMs) / 1000).toFixed(3)} s to ${driverCode(t.drivers[t.medianGapMs <= 0 ? 0 : 1])}`) },
  ], battles.sort((a, b) => (b.wins[0] + b.wins[1]) - (a.wins[0] + a.wins[1])));
}

// ---------- constructors ----------
function renderConstructors() {
  const d = state.data;
  const stats = d.constructorStats;
  Charts.hbars('teamPointsChart', stats.map((s) => teamName(s.constructorId)), stats.map((s) => s.points), { valueLabel: 'Points', format: (v) => String(v) });
  table($('teamStats'), [
    { label: 'Constructor', value: (s) => teamName(s.constructorId) },
    { label: 'Points', num: true, value: (s) => s.points },
    { label: 'Wins', num: true, value: (s) => s.wins },
    { label: 'Podiums', num: true, value: (s) => s.podiums },
    { label: '1–2 finishes', num: true, value: (s) => s.oneTwos },
    { label: 'Average finish', num: true, value: (s) => fmtNum(s.avgFinish) },
    { label: 'Not classified', num: true, value: (s) => s.dnfs },
  ], stats);
}

// ---------- data quality ----------
async function renderQuality() {
  const r = await Api.report(state.season);
  tiles($('qualityTiles'), [
    { label: 'Races processed', value: r.racesProcessed },
    { label: 'Races with lap data', value: r.lapRounds.length, ring: r.racesProcessed ? r.lapRounds.length / r.racesProcessed : undefined },
    { label: 'Rows dropped (errors)', value: r.errors },
    { label: 'Warnings', value: r.warnings },
    { label: 'Points check vs official', value: `${r.pointsCheck.matched}/${r.pointsCheck.checked}`, detail: 'Drivers whose computed points match the official standings', ring: r.pointsCheck.checked ? r.pointsCheck.matched / r.pointsCheck.checked : undefined },
    { label: 'Processed at', value: new Date(r.generatedAt).toLocaleDateString(), detail: new Date(r.generatedAt).toLocaleTimeString() },
  ]);
  table($('qualityIssues'), [
    { label: 'Level', value: (i) => i.level },
    { label: 'Where', value: (i) => i.where },
    { label: 'Issue', value: (i) => i.message },
  ], r.issues.slice(0, 500));
}

// ---------- season loading ----------
async function loadSeason(season) {
  setStatus(`Loading ${season}…`);
  $('main').setAttribute('aria-busy', 'true');
  try {
    await loadSeasonData(season);
  } finally {
    $('main').setAttribute('aria-busy', 'false');
  }
}

async function loadSeasonData(season) {
  const data = await Api.season(season);
  state.season = season;
  state.data = data;
  state.laps = null;
  const d = state.data;
  $('dataSource').textContent = `${season} season · ${d.source}`;
  fillSelect($('raceSelect'), d.races.map((r) => ({ value: String(r.round), label: `R${r.round} ${r.name}${r.hasLaps ? ' · laps' : ''}` })), { keep: false });
  $('raceSelect').value = String(d.races.at(-1)?.round || '');
  const teams = d.constructorStandings.map((c) => ({ value: c.constructorId, label: teamName(c.constructorId) }));
  fillSelect($('raceTeamFilter'), teams, { keep: false, placeholder: 'All' });
  fillSelect($('driverTeamFilter'), teams, { keep: false, placeholder: 'All' });
  $('compareDrivers').innerHTML = '';
  setStatus('');
  renderTab(currentTab());
  document.dispatchEvent(new CustomEvent('f1:season', { detail: { season, data } }));
}

function guard(fn) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { console.error(err); setStatus(err.message, true, () => guard(fn)(...args)); }
  };
}

async function init() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', guard(async () => {
    Motion.toDashboard();
    await showTab(b.dataset.tab);
  })));
  $('seasonSelect').addEventListener('change', guard((e) => loadSeason(Number(e.target.value))));
  ['raceSelect', 'raceTeamFilter', 'lapDrivers', 'lapFilterSlow'].forEach((id) => $(id).addEventListener('change', guard(renderRace)));
  ['driverTeamFilter', 'compareDrivers'].forEach((id) => $(id).addEventListener('change', guard(renderDrivers)));
  document.querySelector('.tabs').addEventListener('keydown', onTabKey);
  document.querySelectorAll('#tab-overview .seg button').forEach((b) => b.addEventListener('click', guard(() => {
    overview.view = b.dataset.view;
    renderProgression();
  })));
  $('driversToggle').addEventListener('click', guard(() => { overview.allDrivers = !overview.allDrivers; renderStandings(); }));
  $('latestRace').addEventListener('click', guard(() => {
    $('raceSelect').value = String(state.data.races.at(-1).round);
    return showTab('race');
  }));
  $('themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
  setTheme(document.documentElement.dataset.theme, false);
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!savedTheme()) setTheme(e.matches ? 'light' : 'dark', false);
  });

  $('retry').addEventListener('click', () => retryAction?.());
  await guard(boot)();
}

// Loads the season list and the newest season. Separate from init so a retry does not add the listeners twice.
async function boot() {
  setStatus('Loading…');
  $('main').setAttribute('aria-busy', 'true');
  let seasons;
  try {
    ({ seasons } = await Api.seasons());
  } finally {
    $('main').setAttribute('aria-busy', 'false');
  }
  if (!seasons.length) {
    setStatus('No processed data yet. Run "npm run ingest -- 2024" then "npm run process -- 2024".', true);
    return;
  }
  // Charts draw text on a canvas, so wait for the fonts before the first one
  try { await document.fonts.ready; } catch { /* older browsers */ }
  fillSelect($('seasonSelect'), seasons.map((s) => ({ value: String(s), label: String(s) })), { keep: false });
  let tab = 'overview';
  try { tab = localStorage.getItem('f1.tab') || tab; } catch { /* ignore */ }
  markTab(TAB_TITLES[tab] ? tab : 'overview');
  await loadSeason(seasons[0]);
}

guard(init)();
