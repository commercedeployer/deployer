'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-mcp-'));
const dataDir = path.join(tmpDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'mcptest';
process.env.ADMIN_PASSWORD = 'mcppass123';
process.env.DEPLOYER_SECRET = 'mcp-test-secret-min-32-chars-long';
process.env.TEMPLATES_DIR = path.join(tmpDir, 'templates');
process.env.TEMPLATES_BUNDLED_DIR = path.join(__dirname, '..', 'templates-bundled');
process.env.DEPLOYER_DATA_DIR = dataDir;
process.env.DEPLOYER_PUBLIC_BASE_URL = 'http://deployer.test';

const { syncTemplatesFromDefault } = require('../server/templates');
syncTemplatesFromDefault(process.env.TEMPLATES_DIR);

const { buildMcpKeyRecord } = require('../server/mcp/mcpKeyService');
const mcpKeyStore = require('../server/mcp/mcpKeyStore');
const app = require('../server/index.js');

describe('Deployer MCP', () => {
  let cookie = '';
  let plaintext = '';

  before(async () => {
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'mcptest', password: 'mcppass123' });
    assert.strictEqual(login.status, 200);
    cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');

    const { record, plaintext: pt } = buildMcpKeyRecord({
      label: 'test',
      createdBy: 'admin',
    });
    plaintext = pt;
    mcpKeyStore.insertKey(record);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('MCP initialize requires bearer', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.strictEqual(res.status, 401);
  });

  it('MCP initialize with valid key', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.result.protocolVersion, '2025-06-18');
    assert.ok(res.headers['mcp-session-id']);
    assert.ok(res.body.result.instructions);
    assert.match(res.body.result.instructions, /Deployer MCP/);
  });

  it('MCP tools/list returns all deployer tools', async () => {
    const init = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sessionId = init.headers['mcp-session-id'];

    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.strictEqual(res.status, 200);
    const names = res.body.result.tools.map((t) => t.name);
    assert.ok(names.includes('deployer_capabilities'));
    assert.ok(names.includes('deployer_deploy'));
    assert.ok(!names.includes('deployer_mcp_key_list'));
    assert.ok(!names.some((n) => n.includes('vault')));
    assert.strictEqual(names.length, 24);
  });

  it('deployer_capabilities tool call', async () => {
    const init = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sessionId = init.headers['mcp-session-id'];

    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'deployer_capabilities', arguments: {} },
      });
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(parsed.access, 'full_api');
    assert.ok(parsed.keyId);
  });

  it('MCP tools/call rejects removed mcp key tools', async () => {
    const init = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sessionId = init.headers['mcp-session-id'];

    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'deployer_mcp_key_list', arguments: {} },
      });
    assert.strictEqual(res.status, 404);
    assert.match(res.body.error?.message || '', /Unknown tool/i);
  });

  it('GET /api/v1/mcp/keys requires session', async () => {
    const res = await request(app).get('/api/v1/mcp/keys');
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/v1/mcp/keys lists keys', async () => {
    const res = await request(app).get('/api/v1/mcp/keys').set('Cookie', cookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.keyLimit, 5);
    assert.ok(Array.isArray(res.body.keys));
    assert.ok(res.body.mcpUrl.endsWith('/mcp'));
  });

  it('POST /api/v1/mcp/keys enforces limit of 5', async () => {
    for (let i = 0; i < 4; i += 1) {
      const created = await request(app)
        .post('/api/v1/mcp/keys')
        .set('Cookie', cookie)
        .send({ label: `key-${i}` });
      assert.strictEqual(created.status, 201, `iteration ${i}`);
    }
    const sixth = await request(app)
      .post('/api/v1/mcp/keys')
      .set('Cookie', cookie)
      .send({ label: 'overflow' });
    assert.strictEqual(sixth.status, 400);
    assert.strictEqual(sixth.body.code, 'mcp_key_limit');
  });

  it('revoked key returns 401 on MCP', async () => {
    const { record, plaintext: pt } = buildMcpKeyRecord({
      label: 'revoke-me',
      createdBy: 'admin',
    });
    mcpKeyStore.insertKey(record);
    const revoke = await request(app)
      .post(`/api/v1/mcp/keys/${record.key_id}/revoke`)
      .set('Cookie', cookie)
      .send({});
    assert.strictEqual(revoke.status, 200);

    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${pt}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.strictEqual(res.status, 401);
  });
});
