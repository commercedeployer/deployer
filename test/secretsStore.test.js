'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-vault-'));

process.env.DEPLOY_BASE_PATH = tmpBase;

const secretsStore = require('../server/secretsStore');
const templates = require('../server/templates');

after(() => {
  secretsStore.invalidateVaultCache();
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch (_) {}
});

beforeEach(() => {
  secretsStore.invalidateVaultCache();
  const file = path.join(tmpBase, 'secrets.json');
  try {
    fs.rmSync(file, { force: true });
  } catch (_) {}
});

describe('secretsStore', () => {
  it('setVaultSecret and listVaultKeys without exposing values', () => {
    secretsStore.setVaultSecret('POSTGRES_ADMIN_URL', 'postgresql://u:p@postgres:5432/postgres');
    const list = secretsStore.listVaultKeys();
    assert.deepEqual(list, [{ key: 'POSTGRES_ADMIN_URL', set: true }]);
    assert.strictEqual(secretsStore.resolveVaultValue('POSTGRES_ADMIN_URL'), 'postgresql://u:p@postgres:5432/postgres');
  });

  it('rejects reserved keys', () => {
    assert.throws(() => secretsStore.setVaultSecret('API_KEY', 'x'), /vault_invalid_key/);
    assert.throws(() => secretsStore.setVaultSecret('DEPLOYER_SECRET', 'x'), /vault_invalid_key/);
  });

  it('env fallback when registered key has empty file value', () => {
    secretsStore.setVaultSecret('SALT', '');
    process.env.SALT = 'env-salt-value';
    try {
      assert.strictEqual(secretsStore.resolveVaultValue('SALT'), 'env-salt-value');
    } finally {
      delete process.env.SALT;
    }
  });

  it('file value wins over env fallback', () => {
    secretsStore.setVaultSecret('SALT', 'file-salt');
    process.env.SALT = 'env-salt';
    try {
      assert.strictEqual(secretsStore.resolveVaultValue('SALT'), 'file-salt');
    } finally {
      delete process.env.SALT;
    }
  });

  it('unregistered key does not resolve from env', () => {
    process.env.UNREGISTERED_TEST_KEY = 'secret';
    try {
      assert.strictEqual(secretsStore.resolveVaultValue('UNREGISTERED_TEST_KEY'), null);
    } finally {
      delete process.env.UNREGISTERED_TEST_KEY;
    }
  });

  it('deleteVaultSecret removes key', () => {
    secretsStore.setVaultSecret('MY_KEY', 'v');
    const del = secretsStore.deleteVaultSecret('MY_KEY');
    assert.equal(del.deleted, true);
    assert.equal(secretsStore.resolveVaultValue('MY_KEY'), null);
  });
});

describe('substitute vault priority', () => {
  it('params beat vault', () => {
    secretsStore.setVaultSecret('SALT', 'from-vault');
    const out = templates.substitute('{{SALT}}', { SALT: 'from-params' }, {});
    assert.equal(out, 'from-params');
  });

  it('context beats vault when not in params', () => {
    secretsStore.setVaultSecret('MY_CTX_KEY', 'vault-val');
    const out = templates.substitute('{{MY_CTX_KEY}}', {}, { MY_CTX_KEY: 'ctx-val' });
    assert.equal(out, 'ctx-val');
  });

  it('vault used when missing in params and context', () => {
    secretsStore.setVaultSecret('POSTGRES_ADMIN_URL', 'postgresql://a:b@c:5432/postgres');
    const out = templates.substitute('{{POSTGRES_ADMIN_URL}}', {}, {});
    assert.equal(out, 'postgresql://a:b@c:5432/postgres');
  });
});
