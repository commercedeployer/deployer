const crypto = require('node:crypto');
const { getSessionSecret } = require('../auth');
const {
  generateMcpKeyPlaintext,
  hashMcpKey,
  keyPrefixFromPlaintext,
} = require('./mcpKeyCrypto');
const mcpKeyStore = require('./mcpKeyStore');
const { parseMcpToolsDeny } = require('./toolPolicy');

const MCP_KEYS_MAX = 5;

function mcpConfig() {
  const publicBaseUrl = String(process.env.DEPLOYER_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return {
    sessionSecret: getSessionSecret(),
    publicBaseUrl,
    toolsDeny: parseMcpToolsDeny(process.env.DEPLOYER_MCP_TOOLS_DENY),
    rateLimit: {
      windowMs: parseInt(process.env.DEPLOYER_MCP_RATE_WINDOW_MS || '60000', 10),
      maxPerWindow: parseInt(process.env.DEPLOYER_MCP_RATE_MAX || '120', 10),
    },
    concurrency: {
      maxConcurrent: parseInt(process.env.DEPLOYER_MCP_MAX_CONCURRENT || '4', 10),
      maxQueued: parseInt(process.env.DEPLOYER_MCP_MAX_QUEUED || '16', 10),
      queueTimeoutMs: parseInt(process.env.DEPLOYER_MCP_QUEUE_TIMEOUT_MS || '60000', 10),
    },
  };
}

function sanitizeListRow(row) {
  if (!row) return null;
  const { key_hash, ...rest } = row;
  return rest;
}

function assertQuotaAvailable() {
  const active = mcpKeyStore.listActiveKeys();
  if (active.length >= MCP_KEYS_MAX) {
    const err = new Error('MCP key limit reached');
    err.statusCode = 400;
    err.code = 'mcp_key_limit';
    err.limit = MCP_KEYS_MAX;
    throw err;
  }
}

function buildMcpKeyRecord({ label, createdBy }) {
  const plaintext = generateMcpKeyPlaintext();
  const keyId = crypto.randomUUID();
  const record = {
    key_id: keyId,
    key_hash: hashMcpKey(plaintext, getSessionSecret()),
    key_prefix: keyPrefixFromPlaintext(plaintext),
    label: String(label || '').trim() || 'MCP key',
    status: 'active',
    last_used_at: null,
    last_used_ip: null,
    created_by: String(createdBy || 'admin'),
    created_at: new Date().toISOString(),
    revoked_at: null,
  };
  return { record, plaintext };
}

function buildCursorMcpConfig(publicBase, plaintext) {
  const base = String(publicBase || '').replace(/\/$/, '');
  return {
    mcpServers: {
      deployer: {
        url: `${base}/mcp`,
        headers: { Authorization: `Bearer ${plaintext}` },
      },
    },
  };
}

function listKeysSummary(publicBase) {
  const keys = mcpKeyStore.listAllKeys();
  return {
    ok: true,
    mcpUrl: `${String(publicBase || '').replace(/\/$/, '')}/mcp`,
    keyLimit: MCP_KEYS_MAX,
    keysRemaining: Math.max(0, MCP_KEYS_MAX - keys.length),
    keys: keys.map(sanitizeListRow),
  };
}

module.exports = {
  MCP_KEYS_MAX,
  mcpConfig,
  sanitizeListRow,
  assertQuotaAvailable,
  buildMcpKeyRecord,
  buildCursorMcpConfig,
  listKeysSummary,
};
