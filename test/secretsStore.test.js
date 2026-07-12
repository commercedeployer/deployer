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
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch (_) {}
});

beforeEach(() => {
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

  it('allows any valid uppercase key including former reserved names', () => {
    secretsStore.setVaultSecret('SHARED_APP_NETWORK', 'proxynet');
    assert.strictEqual(secretsStore.resolveVaultValue('SHARED_APP_NETWORK'), 'proxynet');
  });

  it('rejects invalid key format', () => {
    assert.throws(() => secretsStore.setVaultSecret('bad-key', 'x'), /vault_invalid_key/);
  });

  it('empty vault value does not resolve', () => {
    secretsStore.setVaultSecret('COMMERCE_SALT', '');
    assert.strictEqual(secretsStore.resolveVaultValue('COMMERCE_SALT'), null);
  });

  it('deleteVaultSecret removes key', () => {
    secretsStore.setVaultSecret('MY_KEY', 'v');
    const del = secretsStore.deleteVaultSecret('MY_KEY');
    assert.equal(del.deleted, true);
    assert.equal(secretsStore.resolveVaultValue('MY_KEY'), null);
  });
});

describe('substitute resolution order', () => {
  it('params beat vault', () => {
    secretsStore.setVaultSecret('COMMERCE_SALT', 'from-vault');
    const out = templates.substitute('{{COMMERCE_SALT}}', { COMMERCE_SALT: 'from-params' }, {});
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

  it('deployer env used after vault', () => {
    process.env.DEPLOY_BASE_PATH = '/from-env';
    try {
      const out = templates.substitute('{{DEPLOY_BASE_PATH}}', {}, {});
      assert.equal(out, '/from-env');
    } finally {
      process.env.DEPLOY_BASE_PATH = tmpBase;
    }
  });

  it('params beat deployer env', () => {
    process.env.DEPLOY_BASE_PATH = '/from-env';
    try {
      const out = templates.substitute('{{DEPLOY_BASE_PATH}}', { DEPLOY_BASE_PATH: '/from-params' }, {});
      assert.equal(out, '/from-params');
    } finally {
      process.env.DEPLOY_BASE_PATH = tmpBase;
    }
  });

  it('vault beats deployer env', () => {
    secretsStore.setVaultSecret('COMMERCE_SALT', 'from-vault');
    process.env.COMMERCE_SALT = 'from-env';
    try {
      const out = templates.substitute('{{COMMERCE_SALT}}', {}, {});
      assert.equal(out, 'from-vault');
    } finally {
      delete process.env.COMMERCE_SALT;
    }
  });
});
