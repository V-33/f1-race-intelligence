# Site checklist and rollback

For the animated dashboard (GSAP, ScrollTrigger and Lenis). Run the list on your laptop first (`npm start`, open http://localhost:3000), then once on the deployed instance.

## Before anything: automated checks

- [ ] `npm test` passes (the count is printed at the end; no failures).
- [ ] The browser console (F12 → Console) shows no red errors on any tab.

## Page load and hero

- [ ] The hero plays in: the headline lines rise, the red slab and the pit-stop video slide in, then the paragraph, button and the latest-race line fade up, and the small grid-to-flag chart draws its lines.
- [ ] "Pause video" pauses the hero video and the label changes to "Play video"; "Play video" starts it again.
- [ ] Scrolling down: the headline lifts and fades, the slab slides, the hero video zooms slightly. Scrolling back up reverses it.
- [ ] "Open the dashboard" glides to the dashboard. The brand link in the top bar glides back to the top.

## Band, footer, pointer, scrolling

- [ ] The band shows the Monaco clip with the running figures (races, drivers, teams, season). The text speeds up and leans while you scroll fast, and settles when you stop.
- [ ] The footer lines draw as you scroll to the bottom and un-draw as you scroll back.
- [ ] Mouse only: a red marker follows the pointer exactly and a ring trails it; the ring grows over buttons and tabs and turns red over the video areas; buttons lean toward the pointer. Dropdowns keep the normal cursor.
- [ ] Footer link "Smooth scrolling: on/off" switches inertia scrolling. Reload the page: the choice is remembered. With it off, scrolling is the browser's own.
- [ ] Keyboard: Tab reaches every control with a visible outline; Space, Page Down and the arrow keys scroll the page.

## Overview

- [ ] The five figures count up (63 pts and so on) and end on the right values.
- [ ] **Championship race:** it plays by itself the first time you scroll to it, from round 1 to round 24. It ends on Max Verstappen, 437 points. "Pause" and "Play" work; the slider jumps to any round; the label says "After round N" with the race name.
- [ ] The points chart and the standings tables are unchanged. "Gap to leader" and "View all 24" still work.

## Race tab

- [ ] Round 24 (no lap data): the "Race replay" card is not shown. The rest of the tab works.
- [ ] A round with lap data (1, 8 or 22 locally; the same on the live site after the laps are uploaded): the replay card appears and plays by itself when you reach it. For round 1 the final order is Verstappen, Pérez, Sainz, the real result. The play button, slider and "Lap N of N" label work. Choosing a constructor highlights its two drivers.
- [ ] On a phone-width window the replay scrolls sideways and shows the swipe hint.
- [ ] The helmet clip beside the title plays only on the Race tab.

## Driver comparison tab

- [ ] The heatmap shows all 24 rounds for each selected driver. A dash marks a retirement or a missed race. Cells pop in when you reach it.
- [ ] The driver profile radar shows one shape per selected driver. Hovering a point shows the real figure (for example "P2.5" or "18.2").
- [ ] Changing the driver selection updates the table, the heatmap, the radar and both line charts together.

## Constructors and Data quality tabs

- [ ] Constructors: the bar chart and table are unchanged.
- [ ] Data quality: "Races with lap data" and "Points check vs official" each have a ring that draws in. The points ring is full (24/24).

## Both themes, phone width, reduced motion

- [ ] Light and dark theme: every card, the heatmap, the radar and the bars are readable in both.
- [ ] Phone width (about 390 px): no sideways scrolling of the whole page; bars, tables and the heatmap fit or scroll inside their cards.
- [ ] Reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects off): nothing animates or hides, the videos show a still image, the championship race shows the final standings, and no smooth-scroll switch appears.

## After deploying to EC2

- [ ] `sudo systemctl status f1` shows active (running) and `npm install --omit=dev` finished (it installs GSAP and Lenis).
- [ ] The three vendor files load: open `http://<ip>/vendor/gsap/gsap.min.js`, `.../vendor/gsap/ScrollTrigger.min.js` and `.../vendor/lenis/lenis.min.js` (each shows JavaScript, not a "not found" error).
- [ ] Repeat the lists above on the live address. Rounds 1, 8 and 22 only show lap data and the replay if the 2024 laps were uploaded.

## Rolling back

Three restore points were made before the animation upgrade (the state at commit `6554e70`):

| Where | What it holds |
|---|---|
| Git tag `site-before-gsap` | The exact commit before any of this work |
| Branch `main` | Untouched until the upgrade is merged. The upgrade lives on branch `gsap-upgrade` |
| `d:\f1-race-intelligence\backups\before-gsap\` | A plain copy of `frontend/` and `tests/` from that moment, outside git |

To go back to the old site:

- Not merged yet: `git switch main`, then package and deploy as usual. Nothing else is needed.
- Already merged into `main`: `git switch -c rollback site-before-gsap`, then package and deploy from that branch (or `git revert -m 1 <merge commit>` on `main` to undo the merge as a new commit).
- From the plain backup, staying on the same branch: copy the two folders from the backup over the project's `frontend/` and `tests/`, restore the old server and package files with `git checkout site-before-gsap -- package.json package-lock.json backend/src/app.js`, run `npm install`, then `npm test`.

On the server, a redeploy replaces `~/app` completely, so deploying the old version also removes the new files. The animation libraries are npm dependencies, so no AWS setting needs changing in either direction.
