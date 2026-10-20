# B1 processing Lambda

All 58 repository tests passed on 2026-10-19, including five Lambda tests.
Deployed and verified: manual 2025 processing with laps succeeded, and a scheduled
2026 refresh succeeded on 20 October 2026. The live dashboard reads both seasons.

Created in account 414455963976, region ap-south-2:
- Function: `f1-ri-process-season`, Node.js 24.x, x86_64, outside a VPC.
- Handler: `lambda/processSeason/index.handler`; memory 512 MB; timeout 300 seconds.
- Environment: `S3_BUCKET=f1-ri-1`, `DDB_TABLE=f1-race-intelligence`.
- Execution role: `f1-ri-process-season-role-j9fwkqhj`.
- Inline policy `ProcessSeasonStorageWrite`: PutObject only on the bucket's
  raw/processed prefixes, PutItem/BatchWriteItem only on the project table.
- The automatically created CloudWatch logging policy is also attached.

The uploaded ZIP preserves the repository paths and uses runtime AWS SDK v3.
Weekly schedule `f1-ri-weekly-season` invokes with `{}` Mondays 06:00 UTC.
CloudWatch retention is seven days; alarm `f1-ri-process-season-errors` uses
Errors Sum >= 1 / five minutes and SNS topic `f1-ri-alerts`. Confirmed email
delivery was tested. See `docs/TESTING.md` for evidence and permission caveats,
and `docs/DEMO.md` for the walkthrough. Reserved concurrency was recommended
below but has not been configured.

The handler reuses `processSeason`, `awsLayout`, and the upload script's bounded
DynamoDB batch retry helper. It stores the original MRData pages in raw endpoint
files, processes them in memory, then writes the existing dashboard layout.
RUN records use `RUN#<season>` / invocation start timestamp and contain status,
counts, duration and request ID. Exceptions are rethrown for the Errors metric.
An abrupt Lambda timeout cannot write a final FAILED record; a RUNNING record
and the platform timeout log identify that case.

## Console deployment

1. Sign in using the project's authorized console identity.
2. Check Hyderabad (`ap-south-2`) in the region selector before every service.
3. Package the repository paths `lambda/processSeason/index.js`,
   `processing/src/` and `processing/scripts/upload.js` into a ZIP, preserving
   their paths at ZIP root. Do not include node_modules, raw data, credentials,
   .env files or the .git directory. The runtime supplies AWS SDK v3.
4. Create a Node.js Lambda using a supported Node.js runtime, outside a VPC.
   Set handler to `lambda/processSeason/index.handler`, timeout to 300 seconds,
   memory to 512 MB, and reserved concurrency to 1 to avoid concurrent writers.
5. Use a dedicated execution role trusting `lambda.amazonaws.com`. Allow
   `s3:PutObject` only on `arn:aws:s3:::f1-ri-1/raw/*` and
   `arn:aws:s3:::f1-ri-1/processed/*`; allow `dynamodb:PutItem` and
   `dynamodb:BatchWriteItem` only on the existing table ARN copied from the
   ap-south-2 console. Allow log stream creation and writes on this function's
   log group. Precreate that log group and set seven-day retention. Do not
   modify existing f1-ri-* policies or the EC2 role.
6. Set `S3_BUCKET=f1-ri-1` and `DDB_TABLE=f1-race-intelligence`. Lambda supplies
   `AWS_REGION`; the handler rejects regions other than ap-south-2. No keys.
7. Invoke with `{"season":2025,"laps":[1,2]}`. Verify SUCCEEDED, the RUN item,
   processed S3 objects, and the season index. Notify the lead immediately after
   a successful run so they can check the dashboard (allow five minutes).

Do not mark B1 complete until the dashboard check succeeds. B2-B6 follow the
acceptance checks in docs/TASKS.md after this first run.

## Operational limits

Writes across S3 and DynamoDB are not transactional. A partial failure may leave
some new objects; rerun the same season to repair them. A failed run never
publishes a new season index. Existing indexed seasons can show partial updates
during writes. This writer does not delete stale race/driver items if upstream
data removes a previously published entity. A no-laps run marks races as having
no lap data, even if an older lap object remains in S3. Include required lap
rounds on refreshes where the dashboard should retain lap availability.
