const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const path = require('node:path');
const os = require('node:os');

process.env.NODE_ENV = 'test';
process.env.DEPLOY_BASE_PATH = path.join(os.tmpdir(), 'deployer-cap-test');
process.env.CONTAINER_LIMIT = '100';
process.env.DEPLOYER_SYNC_LEGACY = '1';
process.env.API_KEY = 'capacity-test-key';
process.env.DEPLOYER_AUTH_MODE = 'api';
process.env.ADMIN_PASSWORD = 'cap-test-pass';

delete require.cache[require.resolve('../server/auth')];
delete require.cache[require.resolve('../server/index.js')];

const app = require('../server/index');
const { resetForTests } = require('../server/operations');

test('GET /api/capacity returns snapshot', async () => {
  resetForTests();
  const res = await request(app).get('/api/capacity').set('x-api-key', 'capacity-test-key');
  assert.equal(res.status, 200);
  assert.ok('total_containers' in res.body);
  assert.ok('queued_operations' in res.body);
});

test('GET /api/health includes docker field', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.ok(res.body.docker === 'ok' || res.body.docker === 'error');
});
