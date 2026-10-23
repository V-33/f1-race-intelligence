# F1 Race Intelligence Platform

An analytics dashboard for historical Formula 1 data. Pick a season or race to explore results, qualifying, standings, lap times and driver and constructor comparisons. Data is fetched from the public Jolpica-F1 API, validated, turned into statistics, and served by a Node.js/Express backend. The target deployment is AWS (EC2, S3, DynamoDB, Lambda, EventBridge, CloudWatch, SNS); see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Academic mini-project. Team: _[project lead]_, _[teammate]_.

## Features

- **Overview:** standings, season leaders, cumulative points by round.
- **Race:** result and qualifying tables, gap to pole, places gained or lost, lap-time chart with pit and safety-car laps filtered out, per-driver lap consistency.
- **Driver comparison:** up to 4 drivers side by side (points, wins, average finish, average grid and qualifying, positions gained, retirements), finishing position and points charts, teammate qualifying battles.
- **Constructors:** points, wins, podiums, 1–2 finishes, average finish.
- **Data quality:** every dropped or flagged row, plus a check that computed points match the official standings.

## Quick start (local)

Requires Node.js 20 or newer.

```bash
npm install
npm run ingest -- 2024 --laps 1,8,22   # download 2024 (about 50 API requests)
npm run process -- 2024                # validate and compute metrics
npm start                              # http://localhost:3000
npm test                               # automated tests
```

`ingest` saves raw API responses in `data/raw/<season>/`. `process` writes the dashboard's data to `data/processed/<season>/`. To add lap times for more races, re-run `ingest` with more rounds (or `--laps all`, about 300 requests) and then `process` again.

## Project structure

```
backend/      Express API, input validation, data-store interface (local files today)
frontend/     Dashboard: HTML, CSS, plain JavaScript, Chart.js; video/ (clips), img/, js/motion.js, hero.js, cursor.js
processing/   Jolpica client, validation, metrics; CLI scripts for ingest and process
data/         raw/ (API downloads) and processed/ (dashboard data)
docs/         Architecture, data sources, task plan
tests/        node:test suites using a small synthetic season
```

## Interface

- **Look:** one motif, the grid-to-flag slope, runs through the page: the logo, the slanted cut of the hero video, the band, the buttons, the bullet before each card title and the season lines in the footer. Race red marks the slope, the main action and the selection.
- **Hero and band:** a full-screen opening with a looping pit-stop clip and a small grid-to-flag chart of the latest processed race, then a slanted band with a Monaco harbour clip and the season's figures running sideways as you scroll. The Race tab has a small cockpit clip beside its title. Clips live in `frontend/video/` (three short MP4 files with poster images, about 2.7 MB in total, muted, played only while on screen, with a pause button). They are short excerpts from an official Formula 1 highlights video, cropped and edited for this private academic project, and belong to Formula 1 and their owners.
- **Motion:** content reveals on scroll, figures count up, charts draw when they scroll into view, the tab mark slides, and the footer draws the season's championship lines from the data. A pointer layer (red marker, trailing ring, buttons that lean toward the pointer) appears only on devices with a mouse. With reduced motion everything is shown at once and the video stays on its first frame.
- **Theme:** dark or light, from the toggle in the top bar. The first visit follows the system setting and the choice is remembered in the browser. The hero and the band stay dark in both.
- **Team colours:** driver and constructor lines and markers use team colours (`frontend/js/teams.js`). A team's second driver is drawn with a dashed line, so colour is never the only signal. Teams not listed there fall back to a neutral palette.
- **Charts:** drawn with Chart.js using colours from the CSS variables in `frontend/css/styles.css`, so both themes stay in step. The slope chart on the Race tab shows each driver's grid position against their finish.
- **Fonts:** Public Sans and Barlow Condensed, served from `frontend/fonts/` (the page's Content-Security-Policy only allows files from this site). Both are licensed under the SIL Open Font License; the licence texts are in the same folder.
- **Accessibility:** keyboard navigation for the tabs (arrow keys, Home, End), visible focus, text alternatives for charts, and reduced-motion support.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | Status |
| `GET /api/seasons` | Seasons with processed data |
| `GET /api/seasons/:season` | Races, standings, driver and constructor stats, points progression |
| `GET /api/seasons/:season/races/:round` | One race: results, qualifying, sprint, qualifying gaps |
| `GET /api/seasons/:season/races/:round/laps` | Lap times and per-driver lap statistics |
| `GET /api/seasons/:season/compare?drivers=a,b` | Head-to-head data for up to 6 drivers |
| `GET /api/seasons/:season/report` | Validation report |

## Metrics

- **Average finish:** mean finishing position over classified finishes only. Retirements are counted separately.
- **Positions gained:** grid position minus finishing position, for classified finishers who didn't start from the pit lane.
- **Qualifying gap:** each driver's best Q1/Q2/Q3 lap minus the fastest lap of the session.
- **Lap consistency:** standard deviation of a driver's laps within 107% of their median lap, which removes pit, safety-car and first laps.
- **Points:** race plus sprint points, cross-checked against the official standings.

## Status and next steps

Steps 1 to 6 of the brief are done: the dashboard, data processing, the API, the S3 and DynamoDB data stores with an upload script (tested against a real bucket and table), the deployment on EC2 with an IAM instance role ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)), and EC2 app logs in CloudWatch, an EC2 status alarm, a dashboard and an S3 lifecycle rule on `raw/` (same file, "Logs and monitoring"). Lambda, EventBridge, CloudWatch, SNS, end-to-end testing and the demo guide are the teammate's part. Status, known gaps, ownership and the final testing and demo checklist are in [docs/TASKS.md](docs/TASKS.md).

### Using AWS storage

Set `DATA_STORE` to `s3` or `dynamodb` (see [.env.example](.env.example) for the other settings), then:

```bash
node processing/scripts/upload.js 2024 --dry-run   # list what would be written, no AWS calls
node processing/scripts/upload.js 2024             # needs S3_BUCKET, DDB_TABLE and AWS credentials from the AWS CLI
```

`npm run upload -- 2024` runs the same script, but in Windows PowerShell npm takes the `--dry-run` flag for itself and the script then does a real upload. Call `node` directly, as above, when you want a dry run.

## Security

No credentials in the repository. On AWS, access comes from IAM roles. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-decisions).

## Data credit

Data from [Jolpica-F1](https://github.com/jolpica/jolpica-f1), licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This is an unofficial project, not associated with the Formula 1 companies. F1 and related marks belong to Formula One Licensing B.V.
