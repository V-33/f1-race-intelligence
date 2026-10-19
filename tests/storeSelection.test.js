'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../backend/src/data');
const { LocalStore } = require('../backend/src/data/localStore');
const { S3Store } = require('../backend/src/data/s3Store');
const { DynamoStore } = require('../backend/src/data/dynamoStore');

test('local is the default store', () => {
  assert.ok(createStore({}) instanceof LocalStore);
  assert.ok(createStore({ DATA_STORE: 'local' }) instanceof LocalStore);
});

test('DATA_STORE selects the s3 and dynamodb stores', () => {
  assert.ok(createStore({ DATA_STORE: 's3', S3_BUCKET: 'b', AWS_REGION: 'eu-west-1' }) instanceof S3Store);
  assert.ok(createStore({ DATA_STORE: 'dynamodb', S3_BUCKET: 'b', DDB_TABLE: 't', AWS_REGION: 'eu-west-1' }) instanceof DynamoStore);
});

test('missing settings fail at startup with a message that names them', () => {
  assert.throws(() => createStore({ DATA_STORE: 's3' }), /S3_BUCKET/);
  assert.throws(() => createStore({ DATA_STORE: 'dynamodb', S3_BUCKET: 'b' }), /DDB_TABLE/);
  assert.throws(() => createStore({ DATA_STORE: 'dynamodb', DDB_TABLE: 't' }), /S3_BUCKET/);
});

test('an unknown store name is rejected', () => {
  assert.throws(() => createStore({ DATA_STORE: 'redis' }), /Unknown DATA_STORE/);
});
