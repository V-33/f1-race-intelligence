'use strict';
// Data store backed by an S3 bucket laid out like data/processed/ under the "processed/" prefix
// (see processing/src/awsLayout.js). Same four methods as localStore.js.
// Credentials come from the default AWS provider chain (the instance role on EC2).

const { s3Keys } = require('../../../processing/src/awsLayout');
const { TtlCache } = require('./ttlCache');

class S3Store {
  // client is injectable for tests; otherwise a real S3 client is created for the region.
  constructor({ bucket, region, client, ttlMs, now } = {}) {
    if (!bucket) throw new Error('S3_BUCKET is required when DATA_STORE=s3');
    this.bucket = bucket;
    const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
    this.GetObjectCommand = GetObjectCommand;
    this.ListObjectsV2Command = ListObjectsV2Command;
    this.client = client || new S3Client(region ? { region } : {});
    this.cache = new TtlCache(ttlMs, now);
  }

  #read(key) {
    return this.cache.get(key, async () => {
      try {
        const res = await this.client.send(new this.GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return JSON.parse(await res.Body.transformToString());
      } catch (err) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    });
  }

  // Seasons are the processed/<year>/ folders, so there is no index file for two writers to overwrite.
  listSeasons() {
    return this.cache.get(s3Keys.prefix(), async () => {
      const seasons = [];
      let token;
      do {
        const res = await this.client.send(new this.ListObjectsV2Command({
          Bucket: this.bucket, Prefix: s3Keys.prefix(), Delimiter: '/', ContinuationToken: token,
        }));
        for (const { Prefix } of res.CommonPrefixes || []) {
          const year = Prefix.slice(s3Keys.prefix().length).replace(/\/$/, '');
          if (/^\d{4}$/.test(year)) seasons.push(Number(year));
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return seasons.sort((a, b) => a - b);
    });
  }

  getSeason(season) {
    return this.#read(s3Keys.season(season));
  }

  getLaps(season, round) {
    return this.#read(s3Keys.laps(season, round));
  }

  getReport(season) {
    return this.#read(s3Keys.report(season));
  }
}

module.exports = { S3Store };
