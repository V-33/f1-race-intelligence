#!/usr/bin/env node
'use strict';
// Uploads data/processed/<season>/ to S3 and DynamoDB (layout in processing/src/awsLayout.js).
//   node processing/scripts/upload.js 2024 [--only s3|dynamodb] [--dry-run]
// Settings: S3_BUCKET, DDB_TABLE, AWS_REGION. Credentials come from the default AWS provider chain
// (CLI profile or SSO on a laptop). Never put access keys in the repository or .env.
// --dry-run lists what would be written and makes no AWS calls.

const fs = require('node:fs');
const path = require('node:path');
const layout = require('../src/awsLayout');

const PROCESSED_DIR = process.env.PROCESSED_DIR || path.join(__dirname, '..', '..', 'data', 'processed');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Works out what to write without touching AWS.
function planUpload(season, dir = PROCESSED_DIR, now = () => new Date().toISOString()) {
  layout.seasonPk(season); // rejects anything that is not a whole number
  const seasonDir = path.join(dir, String(Number(season)));
  const seasonFile = path.join(seasonDir, 'season.json');
  if (!fs.existsSync(seasonFile)) throw new Error(`No processed data in ${seasonDir}. Run: npm run process -- ${season}`);

  const files = [{ key: layout.s3Keys.season(season), file: seasonFile }];
  const reportFile = path.join(seasonDir, 'report.json');
  if (fs.existsSync(reportFile)) files.push({ key: layout.s3Keys.report(season), file: reportFile });
  const lapDir = path.join(seasonDir, 'laps');
  if (fs.existsSync(lapDir)) {
    for (const f of fs.readdirSync(lapDir).filter((f) => /^\d+\.json$/.test(f))) {
      files.push({ key: layout.s3Keys.laps(season, Number(f.replace('.json', ''))), file: path.join(lapDir, f) });
    }
  }

  const seasonData = JSON.parse(fs.readFileSync(seasonFile, 'utf8'));
  const items = [...layout.splitSeason(seasonData), layout.indexItem(season, now())];
  return { files, items };
}

async function uploadFiles(client, bucket, files, PutObjectCommand) {
  for (const { key, file } of files) {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: fs.readFileSync(file), ContentType: 'application/json',
    }));
  }
}

// Writes items in batches of 25 (the BatchWriteItem limit), retrying anything DynamoDB hands back unprocessed.
async function writeItems(client, table, items, BatchWriteCommand, wait = sleep) {
  for (let i = 0; i < items.length; i += 25) {
    let pending = { [table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) };
    for (let attempt = 0; Object.keys(pending).length; attempt++) {
      if (attempt >= 8) throw new Error(`DynamoDB left ${pending[table].length} items unprocessed after 8 retries`);
      if (attempt > 0) await wait(100 * 2 ** attempt);
      const res = await client.send(new BatchWriteCommand({ RequestItems: pending }));
      pending = res.UnprocessedItems && Object.keys(res.UnprocessedItems).length ? res.UnprocessedItems : {};
    }
  }
}

function parseArgs(argv) {
  const args = { season: null, only: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--only') args.only = argv[++i];
    else if (/^\d{4}$/.test(argv[i])) args.season = Number(argv[i]);
    else throw new Error(`unexpected argument "${argv[i]}"`);
  }
  if (!args.season) throw new Error('missing season');
  if (args.only && !['s3', 'dynamodb'].includes(args.only)) throw new Error('--only must be s3 or dynamodb');
  return args;
}

async function main(argv, env = process.env) {
  const { season, only, dryRun } = parseArgs(argv);
  const doS3 = only !== 'dynamodb';
  const doDdb = only !== 's3';
  const plan = planUpload(season);

  if (dryRun) {
    if (doS3) for (const f of plan.files) console.log(`[upload] would put s3://${env.S3_BUCKET || '<S3_BUCKET>'}/${f.key}`);
    if (doDdb) for (const i of plan.items) console.log(`[upload] would put ${env.DDB_TABLE || '<DDB_TABLE>'}  ${i.PK} / ${i.SK}`);
    console.log(`[upload] dry run: ${doS3 ? plan.files.length : 0} S3 objects, ${doDdb ? plan.items.length : 0} DynamoDB items, nothing written`);
    return;
  }
  if (doS3 && !env.S3_BUCKET) throw new Error('S3_BUCKET is not set');
  if (doDdb && !env.DDB_TABLE) throw new Error('DDB_TABLE is not set');
  const config = env.AWS_REGION ? { region: env.AWS_REGION } : {};

  if (doS3) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    await uploadFiles(new S3Client(config), env.S3_BUCKET, plan.files, PutObjectCommand);
    console.log(`[upload] S3: ${plan.files.length} objects written to s3://${env.S3_BUCKET}/processed/`);
  }
  if (doDdb) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
    const client = DynamoDBDocumentClient.from(new DynamoDBClient(config), { marshallOptions: { removeUndefinedValues: true } });
    await writeItems(client, env.DDB_TABLE, plan.items, BatchWriteCommand);
    console.log(`[upload] DynamoDB: ${plan.items.length} items written to ${env.DDB_TABLE}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[upload] FAILED: ${err.message}`);
    console.error('Usage: upload.js <season> [--only s3|dynamodb] [--dry-run]');
    process.exit(1);
  });
}

module.exports = { planUpload, uploadFiles, writeItems, parseArgs };
