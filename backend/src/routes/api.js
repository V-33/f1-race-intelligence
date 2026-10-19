'use strict';
const express = require('express');
const validate = require('../validate');
const { HttpError } = validate;

function apiRouter(store) {
  const router = express.Router();

  const loadSeason = async (value) => {
    const s = validate.season(value);
    const data = await store.getSeason(s);
    if (!data) throw new HttpError(404, `no data for season ${s}`);
    return data;
  };

  router.get('/health', (req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));

  router.get('/seasons', async (req, res) => res.json({ seasons: await store.listSeasons() }));

  // Full processed season: races, standings, stats, progression
  router.get('/seasons/:season', async (req, res) => res.json(await loadSeason(req.params.season)));

  router.get('/seasons/:season/report', async (req, res) => {
    const report = await store.getReport(validate.season(req.params.season));
    if (!report) throw new HttpError(404, 'no report for that season');
    res.json(report);
  });

  router.get('/seasons/:season/races/:round', async (req, res) => {
    const data = await loadSeason(req.params.season);
    const r = validate.round(req.params.round);
    const race = data.races.find((x) => x.round === r);
    if (!race) throw new HttpError(404, `no race for round ${r}`);
    res.json(race);
  });

  router.get('/seasons/:season/races/:round/laps', async (req, res) => {
    const laps = await store.getLaps(validate.season(req.params.season), validate.round(req.params.round));
    if (!laps) throw new HttpError(404, 'no lap data for that race');
    res.json(laps);
  });

  // Head-to-head: /api/seasons/2024/compare?drivers=max_verstappen,norris
  router.get('/seasons/:season/compare', async (req, res) => {
    const data = await loadSeason(req.params.season);
    const ids = validate.idList(req.query.drivers);
    const unknown = ids.filter((id) => !data.drivers[id]);
    if (unknown.length) throw new HttpError(404, `unknown driver(s): ${unknown.join(', ')}`);
    res.json({
      season: data.season,
      drivers: ids.map((id) => ({
        ...data.drivers[id],
        stats: data.driverStats.find((d) => d.driverId === id) || null,
        progression: data.progression.drivers[id] || [],
        byRace: data.races.map((race) => {
          const r = race.results.find((x) => x.driverId === id);
          const q = race.qualifying.find((x) => x.driverId === id);
          return { round: race.round, name: race.name, grid: r?.grid ?? null, finish: r?.position ?? null,
            classified: r?.classified ?? null, qualifying: q?.position ?? null, points: r?.points ?? 0 };
        }),
      })),
      rounds: data.progression.rounds,
    });
  });

  router.use((req, res) => res.status(404).json({ error: 'not found' }));
  return router;
}

module.exports = { apiRouter };
