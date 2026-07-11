process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DEPLOYER_SECRET = 'test-secret';
delete process.env.API_KEY;

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../server/auth');

describe('auth', () => {
  describe('verifyPassword', () => {
    it('accepts correct credentials', () => {
      assert.strictEqual(auth.verifyPassword('admin', 'test-password'), true);
    });
    it('rejects wrong password', () => {
      assert.strictEqual(auth.verifyPassword('admin', 'wrong'), false);
    });
    it('rejects wrong user', () => {
      assert.strictEqual(auth.verifyPassword('other', 'test-password'), false);
    });
  });

  describe('getDeployerSecret', () => {
    it('returns DEPLOYER_SECRET', () => {
      assert.strictEqual(auth.getDeployerSecret(), 'test-secret');
    });
  });

  describe('isApiKeyValid', () => {
    it('returns false when API_KEY is not set', () => {
      assert.strictEqual(auth.isApiKeyValid('anything'), false);
    });
  });
});
