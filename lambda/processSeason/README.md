# B1 processing Lambda

Implementation is ready for local tests; AWS deployment and acceptance are pending.
No AWS run has been performed by this implementation yet.

The handler reuses `processSeason`, `awsLayout`, and the upload script's bounded
DynamoDB batch retry helper. It stores the original MRData pages in raw endpoint
files, processes them in memory, then writes the existing dashboard layout.
RUN records use `RUN#<season>` / invocation start timestamp and contain status,
counts, duration and request ID. Exceptions are rethrown for the Errors metric.
An abrupt Lambda timeout cannot write a final FAILED record; a RUNNING record
and the platform timeout log identify that case.

## Console deployment

1. Complete initial password change and assign MFA before resource changes.
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
