# Part B test log

Verified 20 October 2026 in account `414455963976`, region **ap-south-2** (Hyderabad). IAM is global. Screenshots are linked below. No access keys were created.

## Results

| Check | Result | Evidence |
|---|---|---|
| Repository tests | PASS: 58 passed, 0 failed, including five Lambda tests (19 October) | `npm test`; `tests/lambda.test.js` |
| B1 manual processing | PASS: 2025, rounds 1 and 2 with laps; 24 races, 21 drivers | [Invocation](images/b1-success.jpg), [S3](images/b1-s3-processed.jpg), [DynamoDB](images/b1-dynamodb-run.jpg) |
| B1 dashboard reads new season | PASS: 2025 selectable; Australian GP lap chart and summary populated | [Race](images/b5-dashboard-race-laps.jpg), [phone](images/b5-dashboard-phone-light.jpg) |
| B2 weekly schedule | PASS: enabled, `cron(0 6 ? * MON *)`, UTC, payload `{}`, flexible window off | [Schedule](images/b2-weekly-enabled.jpg) |
| B2 actual scheduled execution | PASS: one-time validation at 09:00 IST / 03:30 UTC; processed current season 2026 | [Logs](images/b2-scheduled-run-logs.jpg), [log text](images/b2-scheduled-run-logs.txt), [schedule](images/b2-validation-scheduled.jpg) |
| B2 new RUN record | PASS: `RUN#2026` / `2026-10-20T03:30:05.177Z`; 13 requests, 9 S3 objects, 41 season items, 17 races, 23 drivers | [Query](images/b2-dynamodb-scheduled-run.jpg), [record](images/b2-dynamodb-run-details.jpg) |
| B3 log retention | PASS: Lambda log group set to one week (7 days). No separate EC2 CloudWatch log group was present in this region | [Retention](images/b3-log-retention.jpg) |
| B3 forced failure | PASS: `{"season":1800}` rejected; `RUN#1800` FAILED; Errors metric produced ALARM | [Invocation](images/b3-forced-failure.jpg), [alarm](images/b3-alarm-in-alarm.jpg) |
| B4 SNS | PASS: subscription confirmed; alarm action executed successfully at 05:32:13 UTC; recipient confirmed receipt in chat | [Subscription](images/b4-sns-confirmed.jpg), [delivery history](images/b4-alarm-sns-delivery.jpg) |
| B5 scheduled S3 outputs | PASS: `processed/2026/season.json` and `report.json` modified 09:00:20 IST | [Objects](images/b5-s3-scheduled-season.jpg) |
| B5 EC2 API and dashboard | PASS: `/api/seasons` returns 2024, 2025, 2026; 2026 overview renders 17 processed races | [API](images/b5-api-seasons.jpg), [overview](images/b5-dashboard-2026-light.jpg) |
| B5 phone and both themes | PASS: 390 x 844 viewport; light and dark captured; no browser error logs in inspected dashboard session | [Phone light](images/b5-dashboard-phone-light.jpg), [phone dark](images/b5-dashboard-phone-dark.jpg), [desktop dark](images/b5-dashboard-2026-dark.jpg) |
| B5 EC2 cannot write | EXCEPTION: write allowed, by design for the lead. Actual attached role is `ec2-developer`, with `f1-ri-reader` and `f1-ri-uploader`, rather than the role name in the original instructions. No policy detached | [Instance role](images/b5-ec2-instance-role.jpg), [policies](images/b5-ec2-writer-policy.jpg) |
| B5 Lambda storage scope | PASS in IAM simulator: out-of-scope `s3:PutObject` and `dynamodb:PutItem` implicitly denied. Real in-scope writes succeeded in B1/B2 | [S3 denial](images/b5-lambda-s3-denied.jpg), [DynamoDB denial](images/b5-lambda-dynamodb-denied.jpg), [role](images/b1-execution-role-full.jpg) |
| B5 live AccessDenied calls | NOT RUN: negative evidence uses IAM Policy Simulator, not an actual rejected storage request. This distinction remains an acceptance caveat if literal AccessDenied responses are required | Simulator screenshots above |

## Invocation identifiers

- Manual 2025 request: `e657a5bd-9106-40f3-9191-19b5c43c1c65`, completed 19 October at 17:47:11 UTC; duration 47,828.89 ms, maximum memory 141 MB.
- Scheduled 2026 request: `9a6ad6e0-38d7-44b0-a5d1-88e342e8e521`, 20 October 03:30:04–03:30:19 UTC; duration 15,557.05 ms, maximum memory 143 MB. Run-record duration 14,738 ms.
- Controlled failure request: `05cb6843-2cf1-477e-8c5a-15ec403bc2ad`, 20 October 05:30:18 UTC; invalid season, no processing writes, FAILED run metadata.
- Alarm transitioned OK to ALARM at 05:32:13 UTC and successfully executed `arn:aws:sns:ap-south-2:414455963976:f1-ri-alerts`.

## Reproduce

1. Check Hyderabad before each regional service. Open Lambda `f1-ri-process-season`, Test, and invoke `{"season":2025,"laps":[1,2]}`.
2. Query table `f1-race-intelligence` by `PK = RUN#2025`. Check latest timestamp, status and counts. Check S3 `f1-ri-1/processed/2025/` and `laps/`.
3. Allow up to five minutes for the API cache. Open the current EC2 public IP, select 2025, Race, R1 Australian GP. Select 2026 to show the scheduled result.
4. Open the weekly schedule and its target, then the saved scheduled-run logs and RUN#2026 record. A new one-time schedule can verify delivery immediately; weekly processing next runs Monday 06:00 UTC.
5. With the SNS subscription confirmed, invoke `{"season":1800}` once. Wait for the five-minute Errors evaluation. Check alarm history and inbox. Missing metrics are treated as good, so the alarm returns to OK after the failure ages out.
6. For simulation, select the Lambda execution role with both attached policies selected. Test S3 PutObject against `arn:aws:s3:::f1-ri-out-of-scope/processed/probe.json` and DynamoDB PutItem against `arn:aws:dynamodb:ap-south-2:414455963976:table/f1-ri-out-of-scope`. Neither resource needs to exist; no write is performed. The simulator does not prove the result of a live service request.

Do not detach the EC2 uploader policy without the lead's approval. Keep its exception visible rather than calling the read-only check a pass. No existing bucket public-access setting, EC2 role or f1-ri-* policy was changed.

## Remaining operational checks

Review the pre-existing AWS Budget and current spend with the lead before the demo; billing was not revalidated in this run. The existing EC2 instance was already running and remains running. Stop it after the demo according to `DEPLOYMENT.md`. Lambda remains outside a VPC; no new hourly infrastructure was created.
