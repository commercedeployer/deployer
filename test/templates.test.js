'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-test-'));
process.env.TEMPLATES_DIR = tmpDir;

const templates = require('../server/templates');

function deployCtx(extra = {}) {
  return { containerName: 'test-cn', ...extra };
}

describe('templates', () => {
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  });

  describe('substitute', () => {
    it('replaces placeholders', () => {
      assert.strictEqual(templates.substitute('Hello {{NAME}}', { NAME: 'World' }), 'Hello World');
    });
    it('replaces multiple', () => {
      assert.strictEqual(templates.substitute('{{A}}-{{B}}', { A: '1', B: '2' }), '1-2');
    });
    it('escapes regex special chars in key', () => {
      assert.strictEqual(templates.substitute('{{DOMAIN}}', { 'DOMAIN)(.*': 'x' }), '{{DOMAIN}}');
      assert.strictEqual(templates.substitute('{{a.b}}', { 'a.b': 'ok' }), 'ok');
    });
    it('returns non-string as-is', () => {
      assert.strictEqual(templates.substitute(null, {}), null);
    });
    it('hashes password with BCRYPT token', () => {
      const hash = templates.substitute('{{BCRYPT:PASS}}', { PASS: 'secret123' });
      assert.match(hash, /^\$2[aby]\$/);
      assert.ok(require('bcryptjs').compareSync('secret123', hash));
    });
  });

  describe('fillDefaults', () => {
    it('fills missing from template fields default', () => {
      const t = { fields: [{ key: 'X', default: '{{Y}}' }] };
      const filled = templates.fillDefaults(t, { Y: 'y' });
      assert.strictEqual(filled.X, 'y');
    });
    it('fills GEN_UUID in field default', () => {
      const t = { fields: [{ key: 'NAME', default: '{{GEN_UUID}}' }] };
      const filled = templates.fillDefaults(t, {}, { genCache: require('../server/genTokens').createGenCache() });
      assert.match(filled.NAME, /^[0-9a-f-]{36}$/i);
    });
    it('does not override existing', () => {
      const t = { fields: [{ key: 'X', default: 'def' }] };
      const filled = templates.fillDefaults(t, { X: 'given' });
      assert.strictEqual(filled.X, 'given');
    });
  });

  describe('applyParams', () => {
    it('returns ports and networks from template', () => {
      const t = {
        image: 'postgres:16-alpine',
        containerName: 'pg-{{ID}}',
        ports: [{ containerPort: 5432, hostPort: '{{HOST_PORT}}', protocol: 'tcp' }],
        networks: ['backend'],
        env: [],
        volumes: [],
        labels: [],
        fields: [{ key: 'HOST_PORT', default: '5432' }],
      };
      const { spec } = templates.applyParams(t, { ID: '1', HOST_PORT: '5433' }, deployCtx());
      assert.strictEqual(spec.ports.length, 1);
      assert.strictEqual(spec.ports[0].containerPort, 5432);
      assert.strictEqual(spec.ports[0].hostPort, '5433');
      assert.strictEqual(spec.ports[0].protocol, 'tcp');
      assert.deepStrictEqual(spec.networks, [{ name: 'backend', aliases: [], ipv4Address: '' }]);
    });
    it('migrates legacy port and network fields', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        network: 'proxynet',
        port: '{{HOST_PORT}}',
        containerPort: 8080,
        publishPort: true,
        env: [],
        volumes: [],
        labels: [],
        fields: [],
      };
      const { spec } = templates.applyParams(t, { ID: '1', HOST_PORT: '9090' }, deployCtx());
      assert.deepStrictEqual(spec.networks[0], { name: 'proxynet', aliases: [], ipv4Address: '' });
      assert.strictEqual(spec.ports[0].containerPort, 8080);
      assert.strictEqual(spec.ports[0].hostPort, '9090');
    });
    it('uses DEPLOY_BASE_PATH from context', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{NAME}}',
        volumes: [{ host: '{{DEPLOY_BASE_PATH}}/{{NAME}}/data', container: '/data' }],
        env: [],
        labels: [],
        fields: [],
      };
      const { spec } = templates.applyParams(t, { NAME: 'x1' }, deployCtx({ deployBasePath: '/opt/data' }));
      assert.strictEqual(spec.volumes[0].source, '/opt/data/x1/data');
      assert.strictEqual(spec.volumes[0].container, '/data');
      assert.strictEqual(spec.volumes[0].type, 'bind');
    });
    it('returns name, env, volumes, labels from template', () => {
      const t = {
        image: 'img:1',
        name: 'myapp',
        containerName: 'app-{{ID}}',
        env: [{ name: 'X', value: '{{ID}}' }],
        volumes: [{ host: '/data/{{ID}}', container: '/data' }],
        labels: ['traefik.rule=Host(`{{DOMAIN}}`)'],
        fields: [{ key: 'ID', default: '1' }],
      };
      const { spec } = templates.applyParams(t, { ID: '99', DOMAIN: 'x.com' }, deployCtx());
      assert.strictEqual(spec.image, 'img:1');
      assert.strictEqual(spec.name, 'test-cn');
      assert.strictEqual(spec.env.find(e => e.name === 'X')?.value, '99');
      assert.strictEqual(spec.volumes[0].source, '/data/99');
      assert.strictEqual(spec.volumes[0].container, '/data');
      assert.ok(spec.labels.some(l => l.includes('x.com')));
    });
    it('passes restartPolicy into spec', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        restartPolicy: 'always',
        env: [],
        volumes: [],
        labels: [],
        fields: [],
      };
      const { spec } = templates.applyParams(t, { ID: '1' }, deployCtx());
      assert.strictEqual(spec.restartPolicy, 'always');
    });
    it('omits invalid restartPolicy from spec', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        restartPolicy: 'invalid',
        env: [],
        volumes: [],
        labels: [],
        fields: [],
      };
      const { spec } = templates.applyParams(t, { ID: '1' }, deployCtx());
      assert.strictEqual(spec.restartPolicy, undefined);
    });
    it('uses containerName from deploy context', () => {
      const t = {
        image: 'img:1',
        env: [],
        volumes: [],
        labels: [],
        fields: [],
      };
      const { spec } = templates.applyParams(t, {}, deployCtx({ containerName: 'My-Box-1' }));
      assert.strictEqual(spec.name, 'my-box-1');
    });
    it('errors when containerName missing from context', () => {
      const t = {
        image: 'img:1',
        env: [],
        volumes: [],
        labels: [],
        fields: [{ key: 'HOST_PORT', default: '8080' }],
      };
      assert.throws(
        () => templates.applyParams(t, { HOST_PORT: '8081' }, {}),
        /containerName required/
      );
    });
    it('passes command, limits and dockerParams into spec', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        user: '1000',
        entrypoint: ['/entry'],
        command: ['--flag', '{{FLAG}}'],
        limits: { memory: '512m', cpus: '0.5', memorySwap: '1g' },
        dockerParams: [{ key: 'SecurityOpt', value: 'no-new-privileges:true' }],
        env: [],
        volumes: [],
        labels: [],
        fields: [{ key: 'FLAG', default: 'on' }],
      };
      const { spec } = templates.applyParams(t, { ID: '1' }, deployCtx());
      assert.strictEqual(spec.user, '1000');
      assert.deepStrictEqual(spec.entrypoint, ['/entry']);
      assert.deepStrictEqual(spec.command, ['--flag', 'on']);
      assert.strictEqual(spec.limits.memory, '512m');
      assert.strictEqual(spec.limits.cpus, '0.5');
      assert.strictEqual(spec.limits.memorySwap, '1g');
      assert.strictEqual(spec.dockerParams.length, 1);
    });
    it('passes platform, waitHealthy and network aliases', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        platform: 'linux/amd64',
        waitHealthy: true,
        waitHealthyTimeoutSec: 90,
        restartPolicy: 'on-failure',
        restartMaxRetries: 3,
        networks: [{ name: 'net1', aliases: 'svc,api', ipv4Address: '172.20.0.5' }],
        volumes: [{ type: 'volume', source: 'data-vol', container: '/data', mode: 'ro' }],
        env: [],
        labels: [],
        fields: [{ key: 'ID', default: '1' }],
      };
      const { spec } = templates.applyParams(t, { ID: '1' }, deployCtx());
      assert.strictEqual(spec.platform, 'linux/amd64');
      assert.strictEqual(spec.waitHealthy, true);
      assert.strictEqual(spec.waitHealthyTimeoutSec, 90);
      assert.strictEqual(spec.restartMaxRetries, 3);
      assert.deepStrictEqual(spec.networks[0].aliases, ['svc', 'api']);
      assert.strictEqual(spec.networks[0].ipv4Address, '172.20.0.5');
      assert.strictEqual(spec.volumes[0].type, 'volume');
      assert.strictEqual(spec.volumes[0].mode, 'ro');
    });

    it('supports udp port and expose-only port', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        ports: [
          { containerPort: 53, hostPort: '5353', protocol: 'udp' },
          { containerPort: 8080, protocol: 'tcp' },
        ],
        env: [],
        volumes: [],
        labels: [],
        fields: [{ key: 'ID', default: '1' }],
      };
      const { spec } = templates.applyParams(t, { ID: '1' }, deployCtx());
      assert.strictEqual(spec.ports[0].protocol, 'udp');
      assert.strictEqual(spec.ports[0].hostPort, '5353');
      assert.strictEqual(spec.ports[1].hostPort, '');
    });

    it('resolves multiple networks and config-prefixed dockerParams', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        networks: ['front', { name: 'back', aliases: 'db' }],
        dockerParams: [
          { key: 'config.WorkingDir', value: '/app' },
          { key: 'host.ExtraHosts', value: 'api.local:127.0.0.1' },
        ],
        env: [],
        volumes: [],
        labels: [],
        fields: [{ key: 'ID', default: '1' }],
      };
      const { spec } = templates.applyParams(t, { ID: '1' }, deployCtx());
      assert.strictEqual(spec.networks.length, 2);
      assert.strictEqual(spec.networks[1].aliases[0], 'db');
      assert.strictEqual(spec.dockerParams.length, 2);
      assert.strictEqual(spec.dockerParams[0].key, 'config.WorkingDir');
      assert.strictEqual(spec.dockerParams[1].key, 'host.ExtraHosts');
    });

    it('errors on unresolved placeholder in dockerParams', () => {
      const t = {
        image: 'img:1',
        containerName: 'app-{{ID}}',
        dockerParams: [{ key: 'WorkingDir', value: '/{{MISSING}}' }],
        env: [],
        volumes: [],
        labels: [],
        fields: [{ key: 'ID', default: '1' }],
      };
      assert.throws(
        () => templates.applyParams(t, { ID: '1' }, deployCtx()),
        /Missing param: MISSING/,
      );
    });
  });

  describe('loadTemplates', () => {
    it('returns empty array when dir empty or no json', () => {
      const list = templates.loadTemplates();
      assert.ok(Array.isArray(list));
    });
  });

  describe('getTemplateById', () => {
    it('returns null for invalid id', () => {
      assert.strictEqual(templates.getTemplateById(''), null);
      assert.strictEqual(templates.getTemplateById('../etc'), null);
      assert.strictEqual(templates.getTemplateById('a b'), null);
    });
    it('returns null for non-existent id', () => {
      assert.strictEqual(templates.getTemplateById('nonexistent123'), null);
    });
  });

  describe('saveTemplate and getTemplateById and deleteTemplate', () => {
    const testId = 'test-template-id-' + Date.now();
    it('saveTemplate writes file and getTemplateById reads it', () => {
      const t = { id: testId, name: 'Test', image: 'img', fields: [], env: [], volumes: [], labels: [] };
      const saved = templates.saveTemplate(t);
      assert.strictEqual(saved.id, testId);
      const loaded = templates.getTemplateById(testId);
      assert.ok(loaded);
      assert.strictEqual(loaded.name, 'Test');
    });
    it('saveTemplate keeps provision env when UI save omits env block', () => {
      const id = `${testId}-prov-env`;
      templates.saveTemplate({
        id,
        name: 'Prov',
        image: 'img:latest',
        fields: [],
        env: [],
        volumes: [],
        labels: [],
        provision: {
          command: 'bash',
          args: ['-c', 'echo ok'],
          env: { SALT: '1234567890', TENANT: '{{CONTAINER_NAME}}' },
          expect: ['SECRET'],
        },
      });
      const uiSave = {
        id,
        name: 'Prov',
        image: 'img:latest',
        fields: [],
        env: [],
        volumes: [],
        labels: [],
        provision: {
          command: 'bash',
          args: ['-c', 'echo ok'],
          expect: ['SECRET'],
        },
      };
      templates.saveTemplate(uiSave);
      const loaded = templates.getTemplateById(id);
      assert.deepStrictEqual(loaded.provision.env, {
        SALT: '1234567890',
        TENANT: '{{CONTAINER_NAME}}',
      });
      templates.deleteTemplate(id);
    });
    it('saveTemplate throws for invalid id', () => {
      assert.throws(() => templates.saveTemplate({ id: 'bad id', name: 'x' }), /Invalid template id/);
    });
    it('deleteTemplate removes file and returns true', () => {
      const deleted = templates.deleteTemplate(testId);
      assert.strictEqual(deleted, true);
      assert.strictEqual(templates.getTemplateById(testId), null);
    });
    it('deleteTemplate returns false when file missing', () => {
      assert.strictEqual(templates.deleteTemplate(testId), false);
    });
    it('deleteTemplate throws for invalid id', () => {
      assert.throws(() => templates.deleteTemplate('bad id'), /Invalid template id/);
    });
  });
});
