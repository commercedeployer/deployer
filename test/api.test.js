'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-api-'));

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'apitest';
process.env.ADMIN_PASSWORD = 'apipass123';
process.env.SESSION_SECRET = 'api-test-secret';
process.env.TEMPLATES_DIR = tmpDir;
process.env.TEMPLATES_BUNDLED_DIR = path.join(__dirname, '..', 'templates-bundled');

const { syncTemplatesFromDefault } = require('../server/templates');
syncTemplatesFromDefault(tmpDir);

const app = require('../server/index.js');

async function pollOperationStatus(agent, operationId, cookieHeader, expectedStatus, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = await agent.get(`/api/operations/${operationId}`).set('Cookie', cookieHeader);
    assert.strictEqual(poll.status, 200);
    if (poll.body.operation?.status === expectedStatus) return poll.body.operation;
    await new Promise((r) => setTimeout(r, 50));
  }
  const last = await agent.get(`/api/operations/${operationId}`).set('Cookie', cookieHeader);
  assert.strictEqual(last.body.operation?.status, expectedStatus);
}

describe('API', () => {
  let cookie = '';

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('GET /api/health', () => {
    it('returns 200 and { ok: true } without auth', async () => {
      const res = await request(app).get('/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body?.ok, true);
    });
  });

  describe('POST /api/login', () => {
    it('returns 400 when username or password missing', async () => {
      const r1 = await request(app).post('/api/login').send({});
      assert.strictEqual(r1.status, 400);
      const r2 = await request(app).post('/api/login').send({ username: 'a' });
      assert.strictEqual(r2.status, 400);
    });
    it('returns 401 for invalid credentials', async () => {
      const res = await request(app).post('/api/login').send({ username: 'apitest', password: 'wrong' });
      assert.strictEqual(res.status, 401);
    });
    it('returns 200 and sets cookie for valid credentials', async () => {
      const res = await request(app).post('/api/login').send({ username: 'apitest', password: 'apipass123' });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['set-cookie']);
      cookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    });
  });

  describe('GET /api/me', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/me');
      assert.strictEqual(res.status, 401);
    });
    it('returns 200 with session cookie', async () => {
      const res = await request(app).get('/api/me').set('Cookie', cookie);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body?.user, 'apitest');
    });
  });

  describe('GET /api/templates', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/templates').set('Accept', 'application/json');
      assert.strictEqual(res.status, 401);
    });
    it('returns 200 and array with cookie', async () => {
      const res = await request(app).get('/api/templates').set('Cookie', cookie);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 1);
    });
  });

  describe('GET /api/templates/:id', () => {
    it('returns 404 for non-existent id', async () => {
      const res = await request(app).get('/api/templates/nonexistent-id-12345').set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/templates', () => {
    it('returns 400 when id missing', async () => {
      const res = await request(app).post('/api/templates').set('Cookie', cookie).send({ name: 'x' });
      assert.strictEqual(res.status, 400);
    });
    it('returns 200 and saves template with valid body', async () => {
      const id = 'api-test-tpl-' + Date.now();
      const res = await request(app).post('/api/templates').set('Cookie', cookie).send({
        id,
        name: 'API Test Template',
        image: 'alpine:latest',
        fields: [],
        env: [],
        volumes: [],
        labels: [],
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body?.id, id);
      const getRes = await request(app).get('/api/templates/' + id).set('Cookie', cookie);
      assert.strictEqual(getRes.status, 200);
      await request(app).delete('/api/templates/' + id).set('Cookie', cookie);
    });
  });

  describe('DELETE /api/templates/:id', () => {
    it('returns 404 for non-existent', async () => {
      const res = await request(app).delete('/api/templates/nonexistent-id-999').set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/deploy', () => {
    it('returns 400 when templateId or params missing', async () => {
      const r1 = await request(app).post('/api/deploy').set('Cookie', cookie).send({});
      assert.strictEqual(r1.status, 400);
      const r2 = await request(app).post('/api/deploy').set('Cookie', cookie).send({ templateId: 'x' });
      assert.strictEqual(r2.status, 400);
    });
    it('returns 404 when template not found', async () => {
      const res = await request(app).post('/api/deploy').set('Cookie', cookie).send({
        templateId: 'nonexistent-template-id',
        containerName: 'test-ref-404',
        params: { HOST_PORT: '8081' },
      });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/containers', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/containers').set('Accept', 'application/json');
      assert.strictEqual(res.status, 401);
    });
    it('returns 200 with containers, pagination meta, container_limit', async () => {
      const res = await request(app).get('/api/containers').set('Cookie', cookie);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.containers));
      assert.strictEqual(typeof res.body.total, 'number');
      assert.strictEqual(typeof res.body.offset, 'number');
      assert.strictEqual(typeof res.body.limit, 'number');
      assert.strictEqual(typeof res.body.page, 'number');
      assert.strictEqual(typeof res.body.total_pages, 'number');
      assert.strictEqual(typeof res.body.container_limit, 'number');
    });
  });

  describe('GET /api/containers/:id', () => {
    it('returns 404 for non-existent container', async () => {
      const res = await request(app).get('/api/containers/nonexistent-id').set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/containers/:id/stats', () => {
    it('returns 404 for non-existent', async () => {
      const res = await request(app).get('/api/containers/nonexistent-id/stats').set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/containers/:id/logs', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/containers/nonexistent-id/logs').set('Accept', 'application/json');
      assert.strictEqual(res.status, 401);
    });
    it('returns 404 for non-existent container', async () => {
      const res = await request(app).get('/api/containers/nonexistent-id/logs').set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/containers/:id/restart', () => {
    it('accepts async restart and marks operation failed when missing', async () => {
      const res = await request(app)
        .post('/api/containers/nonexistent-id/restart')
        .set('Cookie', cookie)
        .send({});
      assert.strictEqual(res.status, 202);
      assert.ok(res.body.operation?.operationId);
      const op = await pollOperationStatus(request(app), res.body.operation.operationId, cookie, 'failed');
      assert.strictEqual(op.status, 'failed');
    });
  });

  describe('DELETE /api/containers/:id', () => {
    it('accepts async delete when container missing (removeData=false)', async () => {
      const res = await request(app)
        .delete('/api/containers/nonexistent-id')
        .set('Cookie', cookie);
      assert.strictEqual(res.status, 202);
      assert.ok(res.body.operation?.operationId);
      const op = await pollOperationStatus(request(app), res.body.operation.operationId, cookie, 'succeeded');
      assert.strictEqual(op.status, 'succeeded');
      assert.strictEqual(op.result?.alreadyGone, true);
      assert.strictEqual(op.result?.removed, false);
    });

    it('returns 404 when removeData=true and templateId unknown', async () => {
      const res = await request(app)
        .delete('/api/containers/gone?removeData=true&templateId=no-such-template')
        .set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/logout', () => {
    it('returns 200', async () => {
      const res = await request(app).post('/api/logout').set('Cookie', cookie);
      assert.strictEqual(res.status, 200);
    });
  });

  describe('GET /api/openapi.json', () => {
    it('returns OpenAPI spec', async () => {
      const res = await request(app).get('/api/openapi.json');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body?.openapi, '3.0.3');
    });
  });
});
