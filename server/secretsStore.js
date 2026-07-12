/**
 * Deployer vault (сейф): shared secrets for template {{KEY}} substitution.
 * File: {DEPLOY_BASE_PATH}/secrets.json — values never exposed via MCP / API key.
 */
const fs = require('fs');
const path = require('path');
const { deployHostContext } = require('./hostContext');

const VAULT_FILENAME = 'secrets.json';
const VAULT_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Keys that must not be stored or resolved from env fallback. */
const RESERVED_VAULT_KEYS = new Set([
  'API_KEY',
  'ADMIN_PASSWORD',
  'ADMIN_USER',
  'CONTAINER_NAME',
  'DEPLOYER_SECRET',
  'DEPLOY_BASE_PATH',
  'NODE_ENV',
  'PATH',
  'PORT',
  'SHARED_APP_NETWORK',
  'TEMPLATES_DIR',
  'TEMPLATES_BUNDLED_DIR',
  'DEPLOYER_TEMPLATES_RESTORE_DIR',
  'HOME',
  'HOSTNAME',
  'PWD',
]);

let cache = {
  filePath: null,
  mtimeMs: null,
  data: {},
};

function resolveVaultFilePath() {
  const host = deployHostContext();
  const base = host.DEPLOY_BASE_PATH || '/opt/deploy-data';
  return path.join(String(base).replace(/\/+$/, ''), VAULT_FILENAME);
}

function normalizeKey(raw) {
  const key = String(raw ?? '').trim();
  if (!VAULT_KEY_RE.test(key)) return null;
  if (RESERVED_VAULT_KEYS.has(key)) return null;
  return key;
}

function isReservedVaultKey(key) {
  const k = String(key ?? '').trim();
  return RESERVED_VAULT_KEYS.has(k);
}

function isValidVaultKey(key) {
  return normalizeKey(key) != null;
}

function readFileRaw(filePath) {
  if (!fs.existsSync(filePath)) {
    return { mtimeMs: 0, data: {} };
  }
  const stat = fs.statSync(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) {
    return { mtimeMs: stat.mtimeMs, data: {} };
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('vault_invalid_json');
  }
  const data = {};
  for (const [k, v] of Object.entries(parsed)) {
    const nk = normalizeKey(k);
    if (!nk) continue;
    if (v == null) {
      data[nk] = '';
    } else {
      data[nk] = String(v);
    }
  }
  return { mtimeMs: stat.mtimeMs, data };
}

function loadVault(force = false) {
  const filePath = resolveVaultFilePath();
  if (!force && cache.filePath === filePath && fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (cache.mtimeMs === stat.mtimeMs) return cache.data;
    } catch {
      // fall through to reload
    }
  }
  const { mtimeMs, data } = readFileRaw(filePath);
  cache = { filePath, mtimeMs, data: { ...data } };
  return cache.data;
}

function invalidateVaultCache() {
  cache = { filePath: null, mtimeMs: null, data: {} };
}

function isRegisteredVaultKey(key) {
  const nk = normalizeKey(key);
  if (!nk) return false;
  const data = loadVault();
  return Object.prototype.hasOwnProperty.call(data, nk);
}

function fileValueForKey(key) {
  const nk = normalizeKey(key);
  if (!nk) return undefined;
  const data = loadVault();
  if (!Object.prototype.hasOwnProperty.call(data, nk)) return undefined;
  return data[nk];
}

function envFallbackForKey(key) {
  const nk = normalizeKey(key);
  if (!nk || isReservedVaultKey(nk)) return null;
  if (!isRegisteredVaultKey(nk)) return null;
  const fromFile = fileValueForKey(nk);
  if (fromFile != null && String(fromFile).trim() !== '') return null;
  const fromEnv = process.env[nk];
  if (fromEnv == null || String(fromEnv).trim() === '') return null;
  return String(fromEnv);
}

/**
 * Resolve vault value for template substitution (after params/context miss).
 */
function resolveVaultValue(key) {
  const nk = normalizeKey(key);
  if (!nk) return null;
  if (!isRegisteredVaultKey(nk)) return null;
  const fromFile = fileValueForKey(nk);
  if (fromFile != null && String(fromFile).trim() !== '') return String(fromFile);
  return envFallbackForKey(nk);
}

function listVaultKeys() {
  const data = loadVault();
  return Object.keys(data)
    .sort()
    .map((key) => ({
      key,
      set: String(data[key] ?? '').trim() !== '' || envFallbackForKey(key) != null,
    }));
}

function writeVaultAtomic(data) {
  const filePath = resolveVaultFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // Windows or restricted FS
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore
  }
  invalidateVaultCache();
  loadVault(true);
}

function setVaultSecret(key, value) {
  const nk = normalizeKey(key);
  if (!nk) {
    const err = new Error('vault_invalid_key');
    err.code = 'vault_invalid_key';
    throw err;
  }
  const data = { ...loadVault() };
  data[nk] = value == null ? '' : String(value);
  writeVaultAtomic(data);
  return { key: nk, set: String(data[nk]).trim() !== '' };
}

function deleteVaultSecret(key) {
  const nk = normalizeKey(key);
  if (!nk) {
    const err = new Error('vault_invalid_key');
    err.code = 'vault_invalid_key';
    throw err;
  }
  const data = { ...loadVault() };
  if (!Object.prototype.hasOwnProperty.call(data, nk)) {
    return { key: nk, deleted: false };
  }
  delete data[nk];
  writeVaultAtomic(data);
  return { key: nk, deleted: true };
}

/** Test helper: override vault file location. */
function resetVaultForTests({ filePath, data } = {}) {
  if (filePath) {
    cache = { filePath, mtimeMs: -1, data: data ? { ...data } : {} };
    if (data) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      cache.mtimeMs = fs.statSync(filePath).mtimeMs;
    }
    return;
  }
  invalidateVaultCache();
}

module.exports = {
  VAULT_FILENAME,
  VAULT_KEY_RE,
  RESERVED_VAULT_KEYS,
  resolveVaultFilePath,
  normalizeKey,
  isReservedVaultKey,
  isValidVaultKey,
  isRegisteredVaultKey,
  resolveVaultValue,
  listVaultKeys,
  setVaultSecret,
  deleteVaultSecret,
  loadVault,
  invalidateVaultCache,
  resetVaultForTests,
};
