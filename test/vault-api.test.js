'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-vault-api-'));
const vaultBase = path.join(tmpDir, 'deploy-data');

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'vaulttest';
process.env.ADMIN_PASSWORD = 'vaultpass123';
process.env.DEPLOYER_SECRET = 'vault-api-test-secret-min-32-chars';
process.env.API_KEY = 'vault-test-api-key';
process.env.TEMPLATES_DIR = path.join(tmpDir, 'templates');
process.env.TEMPLATES_BUNDLED_DIR = path.join(__dirname, '..', 'templates-bundled');
process.env.DEPLOY_BASE_PATH = vaultBase;

const { syncTemplatesFromDefault } = require('../server/templates');

fs.mkdirSync(process.env.TEMPLATES_DIR, { recursive: true });
syncTemplatesFromDefault(process.env.TEMPLATES_DIR);

const app = require('../server/index.js');

describe('Vault API', () => {
  let cookie = '';

  before(async () => {
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'vaulttest', password: 'vaultpass123' });
    assert.equal(login.status, 200);
    cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('GET /api/vault returns keys without values (session)', async () => {
    const put = await request(app)
      .put('/api/vault/POSTGRES_ADMIN_URL')
      .set('Cookie', cookie)
      .send({ value: 'postgresql://u:secret@postgres:5432/postgres' });
    assert.equal(put.status, 200);

    const res = await request(app).get('/api/vault').set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.keys));
    const row = res.body.keys.find((k) => k.key === 'POSTGRES_ADMIN_URL');
    assert.ok(row);
    assert.equal(row.set, true);
    assert.equal(res.body.keys.some((k) => k.value != null), false);
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
  });

  it('GET /api/vault rejects x-api-key', async () => {
    const res = await request(app)
      .get('/api/vault')
      .set('x-api-key', 'vault-test-api-key')
      .set('Accept', 'application/json');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'vault_session_required');
  });

  it('PUT /api/vault rejects x-api-key', async () => {
    const res = await request(app)
      .put('/api/vault/COMMERCE_SALT')
      .set('x-api-key', 'vault-test-api-key')
      .send({ value: 'salt123' });
    assert.equal(res.status, 403);
  });

  it('DELETE /api/vault/:key (session)', async () => {
    await request(app)
      .put('/api/vault/TEMP_KEY')
      .set('Cookie', cookie)
      .send({ value: 'temp' });
    const del = await request(app).delete('/api/vault/TEMP_KEY').set('Cookie', cookie);
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, true);
  });
});
