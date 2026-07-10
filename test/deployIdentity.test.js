'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSlotKey, normalizeDockerContainerName, TEMPLATE_LABEL, templateIdFromLabels } = require('../server/deployIdentity');

describe('deployIdentity', () => {
  it('resolveSlotKey uses containerName', () => {
    assert.equal(resolveSlotKey(' my-box '), 'my-box');
  });

  it('resolveSlotKey falls back to deploy', () => {
    assert.equal(resolveSlotKey(''), 'deploy');
  });

  it('normalizeDockerContainerName lowercases and trims', () => {
    assert.equal(normalizeDockerContainerName(' My-Box '), 'my-box');
  });

  it('normalizeDockerContainerName rejects empty', () => {
    assert.throws(() => normalizeDockerContainerName('  '), /containerName required/);
  });

  it('templateIdFromLabels reads deployer.templateId', () => {
    assert.equal(templateIdFromLabels({ [TEMPLATE_LABEL]: 'wordpress' }), 'wordpress');
    assert.equal(templateIdFromLabels({}), '');
  });
});
