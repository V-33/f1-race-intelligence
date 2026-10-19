'use strict';

const jolpica = require('../../processing/src/jolpica');
const { processSeason } = require('../../processing/src/processSeason');
const { splitSeason, indexItem, s3Keys } = require('../../processing/src/awsLayout');
const { writeItems } = require('../../processing/scripts/upload');

function parseEvent(event = {}) {
  const year = new Date().getUTCFullYear();
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Expected an event object');
  const season = event.season === undefined ? year : event.season;
  if (!Number.isInteger(season) || season < 1950 || season > year) throw new Error('Invalid season');
  const laps = event.laps === undefined ? [] : event.laps;
  if (!Array.isArray(laps) || laps.some(r => !Number.isInteger(r) || r < 1 || r > 30)) {
    throw new Error('laps must be an array of round numbers from 1 to 30');
  }
  return { season, laps: [...new Set(laps)] };
}

// Inject only I/O so tests exercise the real processing and storage layout without AWS.
function createHandler({ getAllPages = jolpica.getAllPages, putObject, putItem, batchWrite, logger = console }) {
  return async function handler(event = {}, context = {}) {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const counts = { requests: 0, s3Objects: 0, seasonItems: 0, races: 0, drivers: 0, lapRounds: 0 };
    let season = Number.isInteger(event?.season) ? event.season : new Date().getUTCFullYear();
    const record = async (status, error) => putItem({
      PK: `RUN#${season}`, SK: startedAt,
      data: { status, counts: { ...counts }, startedAt, finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started, requestId: context.awsRequestId || null, ...(error ? { error } : {}) },
    });
    const save = async (key, value) => {
      await putObject(key, value);
      counts.s3Objects++;
    };
    try {
      const parsed = parseEvent(event);
      season = parsed.season;
      await record('RUNNING');
      const pages = async path => {
        const result = await getAllPages(`${season}/${path}`);
        counts.requests += result.length;
        // Preserve each original MRData envelope, including pagination metadata.
        await save(`raw/${season}/${path}.json`, result);
        return result;
      };
      const raw = { laps: {} };
      raw.races = (await pages('races')).flatMap(p => p.RaceTable.Races);
      for (const [endpoint, key] of [['results', 'Results'], ['qualifying', 'QualifyingResults'], ['sprint', 'SprintResults']]) {
        raw[endpoint] = jolpica.mergeRaces(await pages(endpoint), key);
      }
      for (const endpoint of ['driverstandings', 'constructorstandings']) {
        const standingsKey = endpoint === 'driverstandings' ? 'DriverStandings' : 'ConstructorStandings';
        const lists = (await pages(endpoint)).flatMap(p => p.StandingsTable.StandingsLists);
        // Standings can also span pages; processing expects one complete list.
        raw[endpoint] = lists.length ? [{ ...lists[0], [standingsKey]: lists.flatMap(l => l[standingsKey] || []) }] : [];
      }
      for (const round of parsed.laps) {
        if (!raw.races.some(r => Number(r.round) === round)) throw new Error(`Round ${round} is absent from the season schedule`);
        raw.laps[round] = jolpica.mergeRaces(await pages(`${round}/laps`), 'Laps')[0] || null;
      }
      const { seasonData, lapData, report } = processSeason(season, raw);
      if (!seasonData.races.length) throw new Error('No completed races available; existing processed data was preserved');
      counts.races = seasonData.races.length;
      counts.drivers = seasonData.driverStats.length;
      counts.lapRounds = Object.keys(lapData).length;
      await save(`raw/${season}/manifest.json`, {
        season, source: jolpica.BASE_URL, fetchedAt: new Date().toISOString(),
        license: 'CC BY-NC-SA 4.0 (Jolpica-F1)', requests: counts.requests, lapRounds: parsed.laps,
      });
      await save(s3Keys.report(season), report);
      for (const [round, data] of Object.entries(lapData)) await save(s3Keys.laps(season, round), data);
      await save(s3Keys.season(season), seasonData);
      const items = splitSeason(seasonData);
      await batchWrite(items);
      counts.seasonItems = items.length;
      // Publish the index only after every data write has succeeded.
      await putItem(indexItem(season, seasonData.generatedAt));
      await record('SUCCEEDED');
      logger.log(JSON.stringify({ event: 'seasonProcessed', season, counts }));
      return { season, status: 'SUCCEEDED', counts };
    } catch (error) {
      try { await record('FAILED', error.message); }
      catch (recordError) { logger.error(JSON.stringify({ event: 'runRecordFailed', message: recordError.message })); }
      logger.error(JSON.stringify({ event: 'seasonFailed', season, message: error.message }));
      throw error; // Required for Lambda Errors / CloudWatch alarms.
    }
  };
}

let runtimeHandler;
exports.handler = async (event, context) => {
  if (!runtimeHandler) {
    const { S3_BUCKET, DDB_TABLE, AWS_REGION } = process.env;
    if (!S3_BUCKET || !DDB_TABLE) throw new Error('S3_BUCKET and DDB_TABLE are required');
    if (AWS_REGION !== 'ap-south-2') throw new Error('This deployment must run in ap-south-2');
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
    const s3 = new S3Client({ region: AWS_REGION });
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    runtimeHandler = createHandler({
      putObject: (Key, value) => s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key,
        Body: JSON.stringify(value), ContentType: 'application/json' })),
      putItem: Item => ddb.send(new PutCommand({ TableName: DDB_TABLE, Item })),
      batchWrite: items => writeItems(ddb, DDB_TABLE, items, BatchWriteCommand),
    });
  }
  return runtimeHandler(event, context);
};
exports.createHandler = createHandler;
exports.parseEvent = parseEvent;
