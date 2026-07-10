/**
 * File-backed MCP key storage for standalone Deployer (no Postgres).
 */
const fs = require('node:fs');
const path = require('node:path');
const { hashMcpKey } = require('./mcpKeyCrypto');

function dataDir() {
  if (process.env.DEPLOYER_DATA_DIR) return process.env.DEPLOYER_DATA_DIR;
  const deployBase = process.env.DEPLOY_BASE_PATH;
  if (deployBase) return path.join(deployBase, '.deployer-state');
  return path.join(__dirname, '..', '..', 'data');
}

function keysFilePath() {
  return path.join(dataDir(), 'mcp-keys.json');
}

function ensureDataDir() {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readStore() {
  ensureDataDir();
  const file = keysFilePath();
  if (!fs.existsSync(file)) return { version: 1, keys: [] };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.keys)) return { version: 1, keys: [] };
    return parsed;
  } catch {
    return { version: 1, keys: [] };
  }
}

function writeStore(store) {
  ensureDataDir();
  const file = keysFilePath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function listActiveKeys() {
  return readStore().keys.filter((k) => k.status === 'active');
}

function listAllKeys() {
  return readStore().keys.filter((k) => k.status === 'active');
}

function getKeyById(keyId) {
  return readStore().keys.find((k) => k.key_id === String(keyId)) || null;
}

function insertKey(record) {
  const store = readStore();
  store.keys.push(record);
  writeStore(store);
  return record;
}

function revokeKey(keyId) {
  const store = readStore();
  const row = store.keys.find((k) => k.key_id === String(keyId));
  if (!row) return null;
  if (row.status !== 'active') return row;
  row.status = 'revoked';
  row.revoked_at = new Date().toISOString();
  writeStore(store);
  return row;
}

function resolveFromPlaintext(plaintext, pepper) {
  const hash = hashMcpKey(plaintext, pepper);
  const row = readStore().keys.find((k) => k.status === 'active' && k.key_hash === hash);
  return row || null;
}

function touchUsage(keyId, ip) {
  const store = readStore();
  const row = store.keys.find((k) => k.key_id === String(keyId));
  if (!row || row.status !== 'active') return;
  row.last_used_at = new Date().toISOString();
  if (ip) row.last_used_ip = String(ip);
  writeStore(store);
}

module.exports = {
  dataDir,
  keysFilePath,
  listActiveKeys,
  listAllKeys,
  getKeyById,
  insertKey,
  revokeKey,
  resolveFromPlaintext,
  touchUsage,
  readStore,
};
