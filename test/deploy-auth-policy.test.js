'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('deploy auth policy', () => {
  it('requires x-api-key for /api/deploy when API_KEY is configured', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_USER = 'policyadmin';
    process.env.ADMIN_PASSWORD = 'policypass123';
    process.env.DEPLOYER_SECRET = 'policy-session-secret';
    process.env.API_KEY = 'policy-key-123';
    process.env.DEPLOYER_AUTH_MODE = 'api';

    delete require.cache[require.resolve('../server/auth')];
    delete require.cache[require.resolve('../server/index.js')];
    const app = require('../server/index.js');

    const login = await request(app)
      .post('/api/login')
      .send({ username: 'policyadmin', password: 'policypass123' });
    assert.strictEqual(login.status, 200);
    const cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');

    const bySession = await request(app)
      .post('/api/deploy')
      .set('Cookie', cookie)
      .send({ templateId: 'x', params: {} });
    assert.strictEqual(bySession.status, 401);

    const byKey = await request(app)
      .post('/api/deploy')
      .set('x-api-key', 'policy-key-123')
      .send({ templateId: 'x', containerName: 'policy-ref-1', params: { HOST_PORT: '8081' } });
    // Auth passed, template check should run next.
    assert.strictEqual(byKey.status, 404);
  });
});

