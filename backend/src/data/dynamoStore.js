'use strict';
// Data store backed by a single DynamoDB table (item design in processing/src/awsLayout.js).
// Season data and the season list come from DynamoDB. Lap files and validation reports are
// too big or too rarely read for the table, so they come from S3 through S3Store.
// Credentials come from the default AWS provider chain (the instance role on EC2).

const { seasonPk, SEASONS_PK, assembleSeason } = require('../../../processing/src/awsLayout');
const { S3Store } = require('./s3Store');
const { TtlCache } = require('./ttlCache');

class DynamoStore {
  // client and s3 are injectable for tests.
  constructor({ table, bucket, region, client, s3, ttlMs, now } = {}) {
    if (!table) throw new Error('DDB_TABLE is required when DATA_STORE=dynamodb');
    this.table = table;
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
    this.QueryCommand = QueryCommand;
    this.client = client || DynamoDBDocumentClient.from(new DynamoDBClient(region ? { region } : {}));
    this.s3 = s3 || new S3Store({ bucket, region, ttlMs, now });
    this.cache = new TtlCache(ttlMs, now);
  }

  // All items with the given partition key, following pagination.
  async #queryPartition(pk) {
    const items = [];
    let startKey;
    do {
      const res = await this.client.send(new this.QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: startKey,
      }));
      items.push(...(res.Items || []));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  listSeasons() {
    return this.cache.get(SEASONS_PK, async () => {
      const items = await this.#queryPartition(SEASONS_PK);
      return items.map((i) => Number(i.SK)).sort((a, b) => a - b);
    });
  }

  getSeason(season) {
    const pk = seasonPk(season);
    return this.cache.get(pk, async () => assembleSeason(await this.#queryPartition(pk)));
  }

  getLaps(season, round) {
    return this.s3.getLaps(season, round);
  }

  getReport(season) {
    return this.s3.getReport(season);
  }
}

module.exports = { DynamoStore };
