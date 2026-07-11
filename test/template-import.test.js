'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-import-'));
const bundledDir = path.join(__dirname, '..', 'templates-bundled');

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'importtest';
process.env.ADMIN_PASSWORD = 'importpass123';
process.env.DEPLOYER_SECRET = 'import-test-secret';
process.env.TEMPLATES_DIR = tmpDir;
process.env.TEMPLATES_BUNDLED_DIR = bundledDir;

const templates = require('../server/templates');

describe('template import and default seed', () => {
  let app;
  let cookie = '';

  before(async () => {
    templates.syncTemplatesFromDefault(tmpDir, bundledDir);
    app = require('../server/index.js');
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'importtest', password: 'importpass123' });
    cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('ensureDefaultTemplates seeds empty work dir from bundled templates', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-seed-'));
    try {
      const prev = process.env.TEMPLATES_DIR;
      process.env.TEMPLATES_DIR = empty;
      delete require.cache[require.resolve('../server/templates')];
      const fresh = require('../server/templates');
      assert.strictEqual(fresh.listTemplateJsonFiles(empty).length, 0);
      const result = fresh.ensureDefaultTemplates();
      assert.ok(result.copied > 0);
      assert.ok(fresh.loadTemplates().length > 0);
      process.env.TEMPLATES_DIR = prev;
      delete require.cache[require.resolve('../server/templates')];
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('syncTemplatesFromDefault restores full catalog after wipe', () => {
    for (const file of templates.listTemplateJsonFiles(tmpDir)) {
      fs.rmSync(path.join(tmpDir, file), { force: true });
    }
    assert.strictEqual(templates.listTemplateJsonFiles(tmpDir).length, 0);
    const result = templates.syncTemplatesFromDefault(tmpDir, bundledDir);
    assert.ok(result.copied.length >= 7);
    assert.ok(templates.loadTemplates().length >= 7);
  });

  it('DELETE all via API then GET reloads bundled defaults', async () => {
    templates.syncTemplatesFromDefault(tmpDir, bundledDir);
    const before = await request(app).get('/api/templates').set('Cookie', cookie);
    assert.ok(before.body.length >= 7);

    for (const tpl of before.body) {
      const del = await request(app).delete(`/api/templates/${encodeURIComponent(tpl.id)}`).set('Cookie', cookie);
      assert.strictEqual(del.status, 200);
    }
    assert.strictEqual(templates.listTemplateJsonFiles(tmpDir).length, 0);

    const after = await request(app).get('/api/templates').set('Cookie', cookie);
    assert.ok(after.body.length >= 7);
    assert.ok(after.body.some((t) => t.id === 'docker-demo-free'));
    assert.ok(templates.listTemplateJsonFiles(tmpDir).length >= 7);
  });

  it('POST import saves template after delete (editor import path)', async () => {
    const samplePath = path.join(bundledDir, 'docker-demo-free.json');
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

    await request(app).delete('/api/templates/docker-demo-free').set('Cookie', cookie);
    assert.strictEqual(templates.getTemplateById('docker-demo-free'), null);

    const imported = await request(app)
      .post('/api/templates')
      .set('Cookie', cookie)
      .send(sample);
    assert.strictEqual(imported.status, 200);
    assert.strictEqual(imported.body.id, 'docker-demo-free');

    const loaded = await request(app).get('/api/templates/docker-demo-free').set('Cookie', cookie);
    assert.strictEqual(loaded.status, 200);
    assert.strictEqual(loaded.body.image, sample.image);

    await request(app).delete('/api/templates/docker-demo-free').set('Cookie', cookie);
    const reimported = await request(app).post('/api/templates').set('Cookie', cookie).send(sample);
    assert.strictEqual(reimported.status, 200);
    assert.ok(templates.getTemplateById('docker-demo-free'));
  });
});
