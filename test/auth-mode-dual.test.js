'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('deploy auth mode dual', () => {
  it('accepts session and x-api-key for /api/deploy when DEPLOYER_AUTH_MODE=dual', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_USER = 'dualadmin';
    process.env.ADMIN_PASSWORD = 'dualpass123';
    process.env.DEPLOYER_SECRET = 'dual-session-secret';
    process.env.API_KEY = 'dual-key-456';
    process.env.DEPLOYER_AUTH_MODE = 'dual';

    delete require.cache[require.resolve('../server/auth')];
    delete require.cache[require.resolve('../server/index.js')];
    const app = require('../server/index.js');

    const login = await request(app)
      .post('/api/login')
      .send({ username: 'dualadmin', password: 'dualpass123' });
    assert.strictEqual(login.status, 200);
    const cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');

    const bySession = await request(app)
      .post('/api/deploy')
      .set('Cookie', cookie)
      .send({ templateId: 'x', containerName: 'dual-session-ref', params: { HOST_PORT: '8081' } });
    assert.strictEqual(bySession.status, 404);

    const byKey = await request(app)
      .post('/api/deploy')
      .set('x-api-key', 'dual-key-456')
      .send({ templateId: 'x', containerName: 'dual-key-ref', params: { HOST_PORT: '8081' } });
    assert.strictEqual(byKey.status, 404);
  });
});
