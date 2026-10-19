# Work plan and ownership

The project follows the 10 steps in the brief. Steps 1 to 6 are done (the lead's Part A). Steps 7 to 10 are Part B, the teammate's. Track progress by ticking the boxes.

## Status (2026-10-19)

**Working and verified**
- Dashboard (Overview, Race, Driver comparison, Constructors, Data quality) with a dark and light theme, team-colour charts and a grid-to-flag chart. Checked in a real browser at several sizes; `npm test` passes.
- Data from Jolpica-F1: ingest, validation and metrics for the 2024 season (`processing/`).
- Express API with input validation and security headers, reading data through a store interface with three stores: local files, S3, and DynamoDB (S3 for laps and reports). The 2024 season was uploaded and read back through both AWS stores.
- Deployed on EC2 with an IAM instance role, running as a systemd service on port 80 (`docs/DEPLOYMENT.md`). The dashboard loads from the public IP and reads DynamoDB and S3.
- AWS Budgets alert, private S3 bucket (Block Public Access on), DynamoDB table on-demand, least-privilege policies for upload and for reading.

**Known gaps**
- Only the 2024 season is loaded. No lap files are in S3, so the Race tab shows "no lap data" for every race. Running `node processing/scripts/ingest.js 2024 --laps 1,8,22`, `process`, and then `upload` adds some.
- The EC2 role also has a writer policy (the lead's choice), so the B5 check "EC2 role cannot write" does not pass as configured.
- The tests cover the code with fake AWS clients and the dashboard in a scripted browser. Nothing yet runs the full scheduled pipeline, because the Lambda and its schedule do not exist.

**Left for the teammate (Part B)**
- B1 Lambda processing function, B2 EventBridge schedule, B3 CloudWatch monitoring, B4 SNS notifications, B5 end-to-end testing and the permission check (`docs/TESTING.md`), B6 demo guide and final documentation (`docs/DEMO.md`, diagram, screenshots).

**For both: final testing and the demo.** See "Final testing and demo" below.

## Done

- [x] **1. Repository structure and architecture doc** (`docs/ARCHITECTURE.md`, `docs/DATA_SOURCES.md`)
- [x] **2. Working dashboard on a small historical dataset** (`frontend/`)
- [x] **3. Data retrieval, validation and metric calculations** (`processing/`)
- [x] **5. Node.js backend connected to the dashboard** (`backend/`, local file store)
- [x] Automated tests: `npm test` (validation, metrics, API, security headers)

## Part A: project lead

- [x] **4. S3 and DynamoDB integration.** `backend/src/data/s3Store.js` and `dynamoStore.js` implement the same four methods as `localStore.js`; `npm run upload` writes `data/processed/` into S3 and DynamoDB using the layout in `docs/ARCHITECTURE.md` (code in `processing/src/awsLayout.js`). Unit-tested with fake AWS clients, and run once against the real bucket and table: upload of the 2024 season, then the dashboard read back with `DATA_STORE=s3` and `DATA_STORE=dynamodb`. Lap files were not part of that run, because none had been processed.
- [x] **6. Deploy the backend to EC2 with an IAM instance role.** Done and checked from a browser: instance with the role attached, security group (SSH from the lead's IP, HTTP from anywhere), the app run by systemd on port 80, reading DynamoDB and S3. Steps, costs and undo are in `docs/DEPLOYMENT.md`.
- [x] AWS billing alert (AWS Budgets) before creating anything else.

## Part B: teammate

Each task is self-contained. Start from the files listed under "Start from"; the "Done when" line is the acceptance check.

### B1. Lambda processing function (brief step 7)
- **Goal:** run ingest and processing in AWS Lambda instead of on a laptop.
- **Start from:** `processing/src/processSeason.js` (pure function, reuse it as is), `processing/src/jolpica.js`, `processing/scripts/ingest.js` (shows the fetch sequence).
- **Build:** `lambda/processSeason/index.js` with a handler taking `{ "season": 2025, "laps": [1,2] }` (default: current season, no laps). It fetches from Jolpica, saves raw JSON to `s3://<bucket>/raw/<season>/`, runs `processSeason()`, writes outputs to S3 and DynamoDB (keys in `docs/ARCHITECTURE.md`), and writes a `RUN#<season>` record with status and counts. Use the AWS SDK v3 that ships with the Node.js Lambda runtime; no access keys.
- **Reuse the layout:** use `processing/src/awsLayout.js` (`splitSeason`, `indexItem`, `s3Keys`) so the items and keys you write are exactly what `dynamoStore` and `s3Store` read. Do not write an `index.json`; the season list in S3 is the `processed/<year>/` folders. The existing upload script (`processing/scripts/upload.js`) shows how to batch the DynamoDB writes.
- **Watch out:** Lambda timeout (raise it to about 5 minutes; lap data is about 12 requests per race at 350 ms each plus latency). Keep it outside the VPC so it doesn't need a NAT gateway.
- **Done when:** a test invocation for one season shows the run record in DynamoDB, files in S3, and the dashboard (with `DATA_STORE=dynamodb`) shows that season.

### B2. EventBridge schedule (brief step 7)
- **Goal:** process new races automatically.
- **Build:** an EventBridge Scheduler or rule, for example `cron(0 6 ? * MON *)` (Mondays 06:00 UTC), targeting the B1 Lambda with input `{}`.
- **Done when:** a scheduled run appears in the Lambda's CloudWatch logs and creates a new `RUN#` record.

### B3. CloudWatch monitoring (brief step 8)
- **Build:** set log retention to 7 days on the Lambda log group (and the EC2 app log group if one is used). Create one alarm on the Lambda `Errors` metric (sum ≥ 1 over 5 minutes). Optionally add a metric filter on the API's JSON request logs for `status >= 500`.
- **Done when:** forcing a failure (for example, invoking with `{ "season": 1800 }`) puts the alarm into ALARM state.

### B4. SNS notifications (brief step 8, optional in the brief)
- **Build:** an SNS topic with the team's email subscription, used as the B3 alarm action. Optionally have the Lambda publish a short "season processed" message on success.
- **Done when:** the forced failure from B3 produces an email.

### B5. End-to-end testing and permission check (brief step 9)
- **Build:** a test log in `docs/TESTING.md` with screenshots: scheduled run → S3 and DynamoDB → API on EC2 → dashboard. Also confirm least privilege: the EC2 role **cannot** write to S3 or DynamoDB, and the Lambda role can only touch this bucket and table (show an AccessDenied example for each).
- **Note on the EC2 role (added by the lead):** the instance role currently carries a writer policy as well as `f1-ri-reader`, on purpose. To get the AccessDenied evidence, detach the writer policy from `f1-ri-ec2-role` for the test (IAM → Roles → `f1-ri-ec2-role`), run `aws s3 cp /etc/hostname s3://<bucket>/processed/test.txt` on the instance, screenshot the AccessDenied, and re-attach it if the lead wants it back. If the policy stays attached, record that row as "write allowed, by design for the lead" in the test log rather than a pass.
- **Done when:** every row in the test log has a result and evidence.

### B6. Demo guide and final documentation (brief step 10)
- **Build:** `docs/DEMO.md` (a 5-minute walkthrough script), the final architecture diagram image, and dashboard screenshots in `docs/images/`.
- **Done when:** someone who hasn't seen the project can run the demo from the guide.

## Final testing and demo (both)

Do these in order near the end. The teammate records the results in `docs/TESTING.md` (B5); the lead brings the dashboard and EC2 side.

**Before the day**
- [ ] Both: `git pull`, `npm install`, `npm test` shows all tests passing.
- [ ] Lead: run the lap ingest for two or three races, `process`, `upload`, so the Race tab shows the lap chart on the live site.
- [ ] Teammate: B1 to B4 deployed, and one scheduled or manual Lambda run has produced a `RUN#` record, S3 files and a season in DynamoDB.
- [ ] Both: check the AWS Budgets alert is still set and see what has been spent so far.

**Test run (screenshots for `docs/TESTING.md`)**
1. Trigger the Lambda for a season (manual test, then the schedule): the `RUN#<season>` item appears in DynamoDB, files appear under `processed/<season>/` in S3.
2. Open the dashboard on EC2 (up to 5 minutes later, because the app caches reads): the new season shows in the season list and its charts draw.
3. Force a failure (for example, invoke with `{ "season": 1800 }`): the CloudWatch alarm goes to ALARM and the SNS email arrives.
4. Permission check as described under B5: the EC2 role cannot write, and the Lambda role can only touch this bucket and table.
5. Dashboard on a phone-width window and in both themes, with no errors in the browser console.

**Demo (5 minutes, script in `docs/DEMO.md`)**
- Start the EC2 instance a few minutes early and copy the **new public IP** from the console (it changes on every start). Confirm `http://<PUBLIC-IP>/` loads. The service starts by itself.
- Suggested order: architecture diagram → dashboard (Overview, Race grid-to-flag chart, driver comparison, data quality) → AWS console (S3 objects, DynamoDB items, EC2 with its role) → Lambda and its schedule → CloudWatch alarm and the email → least privilege (AccessDenied).
- Suggested split: the lead covers the dashboard, EC2, IAM and storage; the teammate covers Lambda, EventBridge, monitoring and the test log.
- Have the screenshots ready in case the network or an AWS service is slow.

**After the demo**
- [ ] Stop the EC2 instance (Instance state → Stop), or terminate it with the undo steps in `docs/DEPLOYMENT.md` when the project is finished.
- [ ] Delete any access keys created for the CLI, and sign out of the root user.

## Dashboard ideas (either person, if time allows)

- Pit-stop analysis using Jolpica's `pitstops` endpoint (stop count and duration per team).
- Multi-season comparison (driver's average finish by year).
- CSV export of the comparison table (saved to S3 as a report).
