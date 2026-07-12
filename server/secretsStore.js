/**
 * Deployer vault (сейф): shared secrets for template {{KEY}} substitution.
 * File: {DEPLOY_BASE_PATH}/secrets.json — values never exposed via MCP / API key.
 */
const fs = require('fs');
const path = require('path');

const VAULT_FILENAME = 'secrets.json';
const VAULT_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

function vaultDeployBasePath() {
  return (process.env.DEPLOY_BASE_PATH || '/opt/deploy-data').replace(/\/+$/, '');
}

function resolveVaultFilePath() {
  return path.join(vaultDeployBasePath(), VAULT_FILENAME);
}

function normalizeKey(raw) {
  const key = String(raw ?? '').trim();
  if (!VAULT_KEY_RE.test(key)) return null;
  return key;
}

function isValidVaultKey(key) {
  return normalizeKey(key) != null;
}

function loadVault() {
  const filePath = resolveVaultFilePath();
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('vault_invalid_json');
  }
  const data = {};
  for (const [k, v] of Object.entries(parsed)) {
    const nk = normalizeKey(k);
    if (!nk) continue;
    data[nk] = v == null ? '' : String(v);
  }
  return data;
}

function resolveVaultValue(key) {
  const nk = normalizeKey(key);
  if (!nk) return null;
  const data = loadVault();
  if (!Object.prototype.hasOwnProperty.call(data, nk)) return null;
  const fromFile = data[nk];
  if (fromFile == null || String(fromFile).trim() === '') return null;
  return String(fromFile);
}

function listVaultKeys() {
  const data = loadVault();
  return Object.keys(data)
    .sort()
    .map((key) => ({
      key,
      set: String(data[key] ?? '').trim() !== '',
    }));
}

function writeVaultAtomic(data) {
  const filePath = resolveVaultFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

function isRegisteredVaultKey(key) {
  const nk = normalizeKey(key);
  if (!nk) return false;
  return Object.prototype.hasOwnProperty.call(loadVault(), nk);
}

/** Test helper: write secrets.json under DEPLOY_BASE_PATH. */
function resetVaultForTests({ data } = {}) {
  const filePath = resolveVaultFilePath();
  if (data == null) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // ignore
    }
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  VAULT_FILENAME,
  VAULT_KEY_RE,
  resolveVaultFilePath,
  normalizeKey,
  isValidVaultKey,
  isRegisteredVaultKey,
  resolveVaultValue,
  listVaultKeys,
  setVaultSecret,
  deleteVaultSecret,
  loadVault,
  resetVaultForTests,
};
