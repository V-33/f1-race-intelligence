'use strict';
// Thin wrapper around the backend REST API.
const Api = (() => {
  async function get(path) {
    let res;
    try {
      res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('Cannot reach the server. Check that it is running, then try again.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
  return {
    seasons: () => get('/seasons'),
    season: (s) => get(`/seasons/${encodeURIComponent(s)}`),
    report: (s) => get(`/seasons/${encodeURIComponent(s)}/report`),
    laps: (s, r) => get(`/seasons/${encodeURIComponent(s)}/races/${encodeURIComponent(r)}/laps`),
    compare: (s, ids) => get(`/seasons/${encodeURIComponent(s)}/compare?drivers=${ids.map(encodeURIComponent).join(',')}`),
  };
})();
