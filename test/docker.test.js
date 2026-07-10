'use strict';

const fs = require('fs');
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const basePath = path.join(require('os').tmpdir(), 'deployer-base-' + Date.now());
process.env.DEPLOY_BASE_PATH = basePath;
process.env.CONTAINER_LIMIT = '0';

const docker = require('../server/docker');

describe('docker', () => {
  describe('validateVolumePaths', () => {
    it('does not throw for empty or undefined volumes', () => {
      assert.doesNotThrow(() => docker.validateVolumePaths([]));
      assert.doesNotThrow(() => docker.validateVolumePaths(undefined));
    });
    it('does not throw when host path is under DEPLOY_BASE_PATH', () => {
      const vol = { type: 'bind', source: `${basePath}/project/data`, container: '/data' };
      assert.doesNotThrow(() => docker.validateVolumePaths([vol]));
    });
    it('allows named docker volumes', () => {
      assert.doesNotThrow(() => docker.validateVolumePaths([
        { type: 'volume', source: 'my-data', container: '/data' },
      ]));
    });
    it('throws when host path is outside DEPLOY_BASE_PATH', () => {
      assert.throws(
        () => docker.validateVolumePaths([{ type: 'bind', source: '/etc/passwd', container: '/x' }]),
        /Volume host path is outside DEPLOY_BASE_PATH/
      );
      assert.throws(
        () => docker.validateVolumePaths([{ host: '/tmp/other', container: '/data' }]),
        /outside DEPLOY_BASE_PATH/
      );
    });
  });

  describe('CONTAINER_LIMIT', () => {
    it('is a number >= 0', () => {
      assert.strictEqual(typeof docker.CONTAINER_LIMIT, 'number');
      assert.ok(docker.CONTAINER_LIMIT >= 0);
    });
  });

  describe('DEPLOY_BASE_PATH', () => {
    it('is resolved absolute path', () => {
      assert.ok(path.isAbsolute(docker.DEPLOY_BASE_PATH));
    });
  });

  describe('removeDeployDataDir', () => {
    it('removes DEPLOY_BASE_PATH/containerName directory', () => {
      const instanceDir = path.join(basePath, 'purge-me');
      fs.mkdirSync(path.join(instanceDir, 'data'), { recursive: true });
      fs.writeFileSync(path.join(instanceDir, 'data', 'x.txt'), '1');
      const removed = docker.removeDeployDataDir('purge-me');
      assert.ok(removed.some((p) => p.includes('purge-me')));
      assert.ok(!fs.existsSync(instanceDir));
    });

    it('returns empty when directory missing', () => {
      assert.deepStrictEqual(docker.removeDeployDataDir('no-such-instance'), []);
    });
  });
});
