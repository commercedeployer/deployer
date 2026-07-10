'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeSteps,
  buildSubstitutionContext,
  runProvisionBlock,
  resolveDeleteTemplateId,
  resolveDeployIdentifier,
} = require('../server/provisionRunner');

describe('provisionRunner', () => {
  it('normalizeSteps accepts object or array', () => {
    assert.strictEqual(normalizeSteps({ command: 'echo' }).length, 1);
    assert.strictEqual(normalizeSteps([{ command: 'a' }, null, { command: 'b' }]).length, 2);
  });

  it('buildSubstitutionContext sets CONTAINER_NAME', () => {
    const { subs } = buildSubstitutionContext({
      containerName: 'My-App',
      params: { SECRET: 'x' },
      deployBasePath: '/data',
    });
    assert.strictEqual(subs.CONTAINER_NAME, 'my-app');
    assert.strictEqual(subs.SECRET, 'x');
    assert.strictEqual(subs.DEPLOY_BASE_PATH, '/data');
  });

  it('runProvisionBlock runs node script and parses stdout JSON', async () => {
    const script = "console.log(JSON.stringify({ DB_USER: 'u', DB_PASSWORD: 'p' }));";
    const out = await runProvisionBlock(
      {
        command: 'node',
        args: ['-e', script],
        expect: ['DB_USER', 'DB_PASSWORD'],
      },
      { containerName: 'app1', params: {}, deployBasePath: '/tmp' },
    );
    assert.strictEqual(out.DB_USER, 'u');
    assert.strictEqual(out.DB_PASSWORD, 'p');
  });

  it('runProvisionBlock fails with provision_failed phase on bad exit', async () => {
    await assert.rejects(
      () =>
        runProvisionBlock(
          { command: 'node', args: ['-e', 'process.exit(2)'], expect: [] },
          { containerName: 'app1', params: {}, deployBasePath: '/tmp' },
        ),
      (err) => err.phase === 'provision_failed',
    );
  });

  it('resolveDeleteTemplateId prefers query over label', () => {
    const container = { Config: { Labels: { 'deployer.templateId': 'from-label' } } };
    assert.strictEqual(resolveDeleteTemplateId('from-query', container), 'from-query');
    assert.strictEqual(resolveDeleteTemplateId('', container), 'from-label');
    assert.strictEqual(resolveDeleteTemplateId('', null), '');
  });

  it('resolveDeployIdentifier uses label when container present', () => {
    const container = { Config: { Labels: { 'deployer.containerName': 'slot-1' } } };
    assert.strictEqual(resolveDeployIdentifier('docker-id', container), 'slot-1');
    assert.strictEqual(resolveDeployIdentifier('raw-name', null), 'raw-name');
  });
});
