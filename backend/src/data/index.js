'use strict';
// Picks the data store from the DATA_STORE environment variable:
//   local     data/processed/ on disk (default)
//   s3        S3_BUCKET, optional AWS_REGION
//   dynamodb  DDB_TABLE and S3_BUCKET (laps and reports stay in S3), optional AWS_REGION
// The AWS stores are loaded only when selected, so local runs never touch the AWS SDK.

const path = require('node:path');
const { LocalStore } = require('./localStore');

function createStore(env = process.env) {
  const kind = env.DATA_STORE || 'local';
  switch (kind) {
    case 'local':
      return new LocalStore(env.PROCESSED_DIR || path.join(__dirname, '..', '..', '..', 'data', 'processed'));
    case 's3': {
      const { S3Store } = require('./s3Store');
      return new S3Store({ bucket: env.S3_BUCKET, region: env.AWS_REGION });
    }
    case 'dynamodb': {
      if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required when DATA_STORE=dynamodb (laps and reports are read from S3)');
      const { DynamoStore } = require('./dynamoStore');
      return new DynamoStore({ table: env.DDB_TABLE, bucket: env.S3_BUCKET, region: env.AWS_REGION });
    }
    default:
      throw new Error(`Unknown DATA_STORE "${kind}" (expected local, s3 or dynamodb)`);
  }
}

module.exports = { createStore };
