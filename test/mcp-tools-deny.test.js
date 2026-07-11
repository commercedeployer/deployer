'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-mcp-deny-'));
const dataDir = path.join(tmpDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'mcptest';
process.env.ADMIN_PASSWORD = 'mcppass123';
process.env.DEPLOYER_SECRET = 'mcp-test-secret-min-32-chars-long';
process.env.TEMPLATES_DIR = path.join(tmpDir, 'templates');
process.env.TEMPLATES_BUNDLED_DIR = path.join(__dirname, '..', 'templates-bundled');
process.env.DEPLOYER_DATA_DIR = dataDir;
process.env.DEPLOY_BASE_PATH = path.join(tmpDir, 'deploy-data');
process.env.DEPLOYER_PUBLIC_BASE_URL = 'http://deployer.test';
process.env.DEPLOYER_MCP_TOOLS_DENY = 'deployer_container_delete, deployer_template_delete';

const { syncTemplatesFromDefault } = require('../server/templates');
syncTemplatesFromDefault(process.env.TEMPLATES_DIR);

const { buildMcpKeyRecord } = require('../server/mcp/mcpKeyService');
const mcpKeyStore = require('../server/mcp/mcpKeyStore');
const { createAllTools } = require('../server/mcp/toolRegistry');
const app = require('../server/index.js');

describe('Deployer MCP tools denylist', () => {
  let plaintext;

  before(async () => {
    const { record, plaintext: pt } = buildMcpKeyRecord({
      label: 'deny-test',
      createdBy: 'admin',
    });
    mcpKeyStore.insertKey(record);
    plaintext = pt;
  });

  it('tools/list omits denied tools', async () => {
    const init = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      });
    const sessionId = init.headers['mcp-session-id'];
    const list = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const names = list.body.result.tools.map((t) => t.name);
    assert.ok(!names.includes('deployer_container_delete'));
    assert.ok(!names.includes('deployer_template_delete'));
    assert.equal(names.length, createAllTools().length - 2);
  });

  it('tools/call rejects denied tool', async () => {
    const init = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      });
    const sessionId = init.headers['mcp-session-id'];
    const call = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'deployer_container_delete', arguments: { containerIdOrName: 'x' } },
      });
    assert.equal(call.body.result.isError, true);
    assert.match(call.body.result.content[0].text, /tool_disabled_by_policy/);
  });
});
