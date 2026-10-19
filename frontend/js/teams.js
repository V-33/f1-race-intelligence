'use strict';
// Constructor colours for charts, as [dark theme, light theme] pairs. Ids are Jolpica constructor ids.
// Every pair has at least 3:1 contrast against its theme's card colour. A team that is not listed
// gets no colour here and the caller falls back to the neutral series palette.
const Teams = (() => {
  const COLORS = {
    red_bull: ['#4d8ae8', '#2057b0'],
    ferrari: ['#ef3b57', '#c4001f'],
    mercedes: ['#27f4d2', '#00796f'],
    mclaren: ['#ff8000', '#c75a00'],
    aston_martin: ['#2fb585', '#17724f'],
    alpine: ['#ff87bc', '#c93a82'],
    williams: ['#64c4ff', '#1676b8'],
    rb: ['#7a9cff', '#3a58c8'],
    alphatauri: ['#7a9cff', '#3a58c8'],
    toro_rosso: ['#5aa5ff', '#2a68c0'],
    sauber: ['#52e252', '#1f8a1f'],
    alfa: ['#e0506a', '#a8213c'],
    haas: ['#b6babd', '#676b70'],
    renault: ['#ffd800', '#8f7300'],
    racing_point: ['#f596c8', '#b83e86'],
    force_india: ['#f596c8', '#b83e86'],
  };

  const theme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 1 : 0);

  // Colour for a constructor in the current theme, or null when the team is not known
  function colour(constructorId) {
    const pair = COLORS[constructorId];
    return pair ? pair[theme()] : null;
  }

  return { colour };
})();
