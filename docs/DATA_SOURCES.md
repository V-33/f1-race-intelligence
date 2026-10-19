# Data sources

Checked in October 2026. Re-check before the final submission, because terms and limits can change.

| Source | What it offers | Access | Decision |
|---|---|---|---|
| **Jolpica-F1** (`https://api.jolpi.ca/ergast/f1/`) | Schedules, race and sprint results, qualifying, driver and constructor standings, lap times, pit stops, from 1950 on | Free, no key. 4 requests/second burst, 500 requests/hour sustained. Max 100 rows per page. A custom `User-Agent` is required. | **Primary source for everything.** |
| **FastF1** (Python library) | Timing, laps, tyre data and telemetry from 2018 on. Uses Jolpica for results. | Free, open source. Pulls from the F1 live-timing archive and caches locally. | Not used. Would add Python to a Node project. Only worth it for tyre compounds or telemetry, which are out of scope. |
| **OpenF1** (`https://api.openf1.org/v1/`) | Sessions, laps, positions, pit stops, car telemetry (recent seasons only, believed 2023 on) | Open source, historical calls work without a key. Access terms for live data were not confirmed; check openf1.org. | Not used. Jolpica covers what the brief needs with longer history. Possible extension for 2023+ pit-stop or stint detail. |

## Jolpica terms that affect this project

- Free for **non-commercial** use. Fine for an academic project.
- Data is licensed **CC BY-NC-SA 4.0**. The dashboard footer and README credit Jolpica-F1. Exported datasets must keep the same license.
- No uptime guarantee. That's why raw downloads are stored (locally now, in S3 later) and the dashboard never calls Jolpica directly.

## How we stay inside the rate limit

- `processing/src/jolpica.js` waits at least 350 ms between requests (under 4/second) and backs off on HTTP 429 and 5xx.
- Requests use season-wide endpoints (`2024/results`) rather than per-race calls.
- One season without lap data takes about 15 requests. Lap times cost about 12 requests per race, so `--laps all` for a 24-race season is about 300 requests. That fits in one hour, but don't run it twice in the same hour.

## Request budget for one season (approximate)

| Data | Requests |
|---|---|
| Schedule | 1 |
| Race results (about 480 rows) | 5 |
| Qualifying | 5 |
| Sprint results | 1–2 |
| Final standings (drivers and constructors) | 2 |
| Lap times, per race | about 12 |
