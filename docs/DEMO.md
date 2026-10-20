# Five-minute demo

## Before presenting

Use AWS account `414455963976` and **Hyderabad / ap-south-2**. IAM is global. Open [the architecture image](images/architecture-final.svg), this guide, and [the test log](TESTING.md). Use the screenshots if a service is slow.

Find existing EC2 instance `f1-ri-app` (`i-0962216ab22de4054`) and copy its current public IPv4 address. It was `16.112.64.22` at verification; it changes after a stop/start. Open `http://<PUBLIC-IP>/` and `http://<PUBLIC-IP>/api/seasons`. The verified API lists 2024, 2025 and 2026. Allow up to five minutes after processing for cached reads to refresh.

The 2025 season has lap data for rounds 1 and 2. The 2026 scheduled refresh intentionally has no lap data. Confirm the SNS subscription and have the received alarm email ready. Check the existing Budget and current spend with the lead. Run `npm install` and `npm test` if demonstrating from a fresh checkout; last verified result was 58 passing tests.

## Script

| Time | Show | Say |
|---|---|---|
| 0:00–0:40 | Architecture image | Scheduler invokes a Lambda outside a VPC. It downloads Jolpica data, reuses the pure processing code, saves raw and processed JSON to private S3, and writes dashboard records and job metadata to DynamoDB. EC2 serves the API and dashboard using its instance role. |
| 0:40–1:45 | Dashboard | Select 2026: 17 races from the scheduled run. Show championship progression. Select 2025, Race, R1 Australian GP: grid-to-flag and lap statistics. Open Driver comparison and Data quality. Toggle the theme; show the phone screenshots. |
| 1:45–2:30 | S3 and DynamoDB | In S3 `f1-ri-1`, show `processed/2026/season.json` and `report.json`, then `processed/2025/laps/`. In table `f1-race-intelligence`, query `RUN#2026`. Show counts, request ID and completion status. The writer uses `awsLayout.js`, the same layout the API reads. |
| 2:30–3:20 | Lambda and Scheduler | Open `f1-ri-process-season`: Node.js 24, 512 MB, 300-second timeout, no VPC, role credentials. Show weekly `f1-ri-weekly-season`, Monday 06:00 UTC, payload `{}`. Show the one-time validation log at 03:30 UTC, request `9a6ad6e0-38d7-44b0-a5d1-88e342e8e521`. |
| 3:20–4:10 | CloudWatch and email | Show seven-day log retention and `f1-ri-process-season-errors`: Errors Sum >= 1 over five minutes. Show the failed `{season:1800}` invocation, saved ALARM screenshot, history showing successful SNS action, and received email. Alarm may now be OK because missing data is treated as good. |
| 4:10–5:00 | IAM and test log | Show scoped Lambda storage policy and simulator denials for another bucket/table. State that negative tests were simulated. Explain the EC2 uploader policy is retained by the lead's design, so its read-only check is an explicit exception. Show `TESTING.md` with evidence and remaining caveats. |

For a live success invocation, use `{"season":2025,"laps":[1,2]}` and allow about a minute. For a live alarm demonstration, invoke `{"season":1800}` several minutes before that segment so CloudWatch can evaluate it. Do not shorten the production schedule to repeatedly run processing. Do not use credentials in event payloads or code.

## Resource checklist

| Resource | Value |
|---|---|
| Lambda | `f1-ri-process-season` |
| Handler | `lambda/processSeason/index.handler` |
| Storage | Bucket `f1-ri-1`; table `f1-race-intelligence` |
| Lambda role | `f1-ri-process-season-role-j9fwkqhj` |
| Scheduler role | `f1-ri-weekly-invoke-role` |
| Weekly schedule | `f1-ri-weekly-season`, UTC `cron(0 6 ? * MON *)` |
| Validation schedule | `f1-ri-validation-20261020`, one-time 20 October 09:00 IST; no further invocations |
| Log group | `/aws/lambda/f1-ri-process-season` |
| Alarm | `f1-ri-process-season-errors` |
| SNS topic | `f1-ri-alerts` |
| EC2 role observed | `ec2-developer`, reader plus uploader |

## After presenting

Have the lead stop the existing EC2 instance when finished. Keep the weekly schedule enabled if automatic refresh is still wanted; otherwise disable it deliberately. Do not remove the project's data, roles or policies as part of routine demo cleanup. Never create access keys, NAT gateways, load balancers or extra EC2 instances for this walkthrough.
