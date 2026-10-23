# Deployment (EC2)

How the Express app and dashboard run on EC2, written from the deployment that was actually done (region `ap-south-2`, Amazon Linux 2023). It reads season data from DynamoDB and lap files and reports from S3 through the instance's IAM role. There are no access keys on the server.

Names used below: bucket `f1-ri-1`, table `f1-race-intelligence`, instance role `ec2-developer`, security group `f1-ri-sg`. Replace them if you used others. Keep the key pair file (`.pem`) outside the project folder; it is ignored by `.gitignore` but must never be committed.

## What is deployed

| Piece | Setting |
|---|---|
| Instance | t3.micro, Amazon Linux 2023, default VPC, public subnet, auto-assigned public IPv4, 8 GiB gp3 |
| Security group | SSH (22) from the lead's IP only; HTTP (80) from anywhere for demos |
| IAM role | `ec2-developer`, attached to the instance as its instance profile. Carries `f1-ri-reader` (S3 read on `processed/*`, DynamoDB `GetItem` and `Query`), `f1-ri-uploader` and `CloudWatchAgentServerPolicy`. See "Known state" below |
| App | `~/app` on the instance, run by systemd as the `f1` service on port 80 |
| Settings | `DATA_STORE=dynamodb`, `DDB_TABLE`, `S3_BUCKET`, `AWS_REGION`, `PORT=80` (in the service file, no secrets) |

## Steps (as done)

1. **Role.** IAM → Roles → Create role → trusted entity AWS service, use case EC2. Attach `f1-ri-reader`. Name `ec2-developer`.
2. **Instance.** EC2 → Launch instance, name `f1-ri-app`, AMI Amazon Linux 2023, type t3.micro (or the free-tier type your account offers), a new key pair `f1-ri-key` (.pem, downloaded once), the security group above, storage 8 GiB gp3, and under Advanced details the instance profile `ec2-developer`.
3. **Package the app on your laptop.** In PowerShell, from the project folder:
   ```
   tar -czf $env:TEMP\f1app.tgz backend frontend processing package.json package-lock.json
   tar -tzf $env:TEMP\f1app.tgz | Select-String "backend/src/data"
   ```
   The second command must list `dynamoStore.js`, `index.js`, `localStore.js`, `s3Store.js` and `ttlCache.js`. Name the folders to include. Do not exclude by name: `--exclude=data` also removes `backend/src/data` and the server then fails to start with `Cannot find module './data'`.
4. **Copy and connect.** Set `$key` to the .pem path, restrict its permissions (`icacls $key /inheritance:r` then `icacls $key /grant:r "$($env:USERNAME):(R)"`), then:
   ```
   scp -i $key $env:TEMP\f1app.tgz ec2-user@<PUBLIC-IP>:~
   ssh -i $key ec2-user@<PUBLIC-IP>
   ```
5. **On the instance.**
   ```
   sudo dnf install -y nodejs20 npm
   node --version
   mkdir -p ~/app && tar -xzf ~/f1app.tgz -C ~/app && cd ~/app
   npm install --omit=dev
   ```
6. **Try it** (then stop it with Ctrl+C):
   ```
   DATA_STORE=dynamodb DDB_TABLE=f1-race-intelligence S3_BUCKET=f1-ri-1 AWS_REGION=ap-south-2 PORT=3000 node backend/src/server.js
   ```
   From a second SSH window, `curl localhost:3000/api/health` and `curl localhost:3000/api/seasons` should return `status: ok` and `{"seasons":[2024]}`.
7. **Run it as a service on port 80.** Create the service file from "Service file" below, then:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now f1
   sudo systemctl status f1 --no-pager
   ```
   Expected: `active (running)`. If it fails with `status=203/EXEC`, run `which node` and use that path in `ExecStart`. Logs: `journalctl -u f1 -n 50 --no-pager`.
8. **Open `http://<PUBLIC-IP>/`** in a browser (plain HTTP). The Overview should show the season and its charts.

The service is enabled, so it starts again after the instance is stopped and started.

## Service file

Run this on the instance (it writes `/etc/systemd/system/f1.service`; the settings are not secrets). Create the log folder first with `sudo mkdir -p /var/log/f1`; the two `Standard...` lines send the app's output to a file for the CloudWatch agent (see "Logs and monitoring" below).

```
sudo tee /etc/systemd/system/f1.service > /dev/null <<'EOF'
[Unit]
Description=F1 Race Intelligence
After=network.target

[Service]
User=ec2-user
WorkingDirectory=/home/ec2-user/app
ExecStart=/usr/bin/node backend/src/server.js
Environment=NODE_ENV=production
Environment=PORT=80
Environment=DATA_STORE=dynamodb
Environment=DDB_TABLE=f1-race-intelligence
Environment=S3_BUCKET=f1-ri-1
Environment=AWS_REGION=ap-south-2
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
StandardOutput=append:/var/log/f1/app.log
StandardError=append:/var/log/f1/app.log

[Install]
WantedBy=multi-user.target
EOF
```

## Logs and monitoring

Added after the first deployment, set up in the console and over SSH by the lead.

| Piece | Setting |
|---|---|
| App log file | `/var/log/f1/app.log`, written by the service (`StandardOutput` and `StandardError`). The app prints one JSON line per request (`method`, `path`, `status`, `ms`) and a JSON line for each 5xx error. Rotated weekly by `/etc/logrotate.d/f1` (`rotate 2`, `copytruncate`) |
| CloudWatch agent | Package `amazon-cloudwatch-agent`, config `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json`, ships the log file to log group `/f1-ri/app` (stream = instance ID, retention 7 days). Enabled at boot |
| IAM | `CloudWatchAgentServerPolicy` attached to the instance role |
| Alarm | `f1-ri-ec2-status`: EC2 `StatusCheckFailed`, Maximum, 5 minutes, >= 1, missing data treated as good, action: SNS topic `f1-ri-alerts` |
| Dashboard | `f1-ri-overview`: Lambda invocations, errors and duration; EC2 CPU and network out; DynamoDB consumed read and write capacity; alarm status; a Logs Insights table of recent requests |

Agent config:

```
{
  "agent": { "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/var/log/f1/app.log", "log_group_name": "/f1-ri/app", "log_stream_name": "{instance_id}", "retention_in_days": 7 }
        ]
      }
    }
  }
}
```

Install and start: `sudo dnf install -y amazon-cloudwatch-agent`, write the config above, then `sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s` and `sudo systemctl enable amazon-cloudwatch-agent`. Check with `sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -m ec2 -a status`.

Logs widget query: `fields @timestamp, path, status, ms | sort @timestamp desc | limit 20`.

Undo: `sudo systemctl disable --now amazon-cloudwatch-agent` and `sudo dnf remove -y amazon-cloudwatch-agent`; delete the log group, the alarm and the dashboard; detach `CloudWatchAgentServerPolicy`; remove the two `Standard...=append:` lines from the service file, then `sudo systemctl daemon-reload && sudo systemctl restart f1`.

### Storage cost control

S3 lifecycle rule `expire-raw-90d` on bucket `f1-ri-1`: the scope is the prefix `raw/` only, current versions expire after 90 days, and incomplete multipart uploads are removed after 7 days. `processed/` is not covered. The app never reads `raw/`; the Lambda writes it on each run. Undo: S3 → bucket → Management → delete the rule (objects it already expired cannot be restored unless versioning was on).

## Updating the app

Package and copy again (steps 3 and 4; the package now includes `frontend/video/`, about 9 MB of clips, and `frontend/img/`), then on the instance: `cd ~ && rm -rf ~/app && mkdir ~/app && tar -xzf ~/f1app.tgz -C ~/app && cd ~/app && npm install --omit=dev && sudo systemctl restart f1`.

New data needs no redeploy. The app caches reads for 5 minutes, so a new processing run appears within that time. To load a season from a laptop: `node processing/scripts/upload.js 2024` (with `S3_BUCKET`, `DDB_TABLE`, `AWS_REGION` set and AWS credentials from the CLI).

## Known state and cautions

- The lead's role on the instance (`ec2-developer`) also has a writer policy attached on purpose. The app only needs `f1-ri-reader`. The permission check in B5 ("the EC2 role cannot write") therefore does not pass as configured; see the note in `docs/TASKS.md` under B5.
- The public IPv4 address is assigned automatically, so it **changes every time the instance is stopped and started**. Copy the new one from the console before a demo.
- HTTP only, no login. The data is public and there are no user accounts. Narrow the HTTP rule to your own IP between demos if you prefer.
- Root-user credentials on a laptop give full control of the account. Prefer an IAM user for daily work, and delete any access key you created.

## Cost

Approximate, from public price lists (check the EC2 pricing page for your region and the Billing console's Free Tier page for what your account includes):

| Item | Approx. per hour while running |
|---|---|
| t3.micro on-demand | about $0.011 |
| Public IPv4 address | $0.005 |
| 8 GiB gp3 disk | about $0.001 (charged while stopped too) |
| Total | about $0.017 per hour, about $0.40 per day, about $12 per month if left on 24/7 |

S3, DynamoDB on-demand, IAM and the data transfer for this project are cents. A free-tier allowance may cover part of the instance and IP. Stop the instance when you are not demoing. A stopped instance costs only the disk.

## Undo

1. EC2 → Instances → Terminate `f1-ri-app`.
2. Delete the security group `f1-ri-sg` and the key pair `f1-ri-key` (and the .pem file).
3. IAM → delete `ec2-developer` and the policies you no longer need.
4. Empty and delete the S3 bucket and delete the DynamoDB table if the project is finished.
