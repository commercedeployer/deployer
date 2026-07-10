'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const manifest = require('./fixtures/manifest.json');
const { isDockerAvailable } = require('./helpers/dockerAvailable');
const { getFreePort } = require('./helpers/freePort');
const { pollOperation, applyManifestParams, applyManifestContainerName } = require('./helpers/pollOperation');
const { seedTemplatesDir, DEFAULT_SEED_DIR } = require('./helpers/seedTemplates');
const { restoreIntegrationZeroState } = require('./helpers/cleanupIntegration');
const { writeFileInContainer, readFileInContainer } = require('./helpers/containerFile');
const { resetForTests } = require('../../server/operations');

const API_KEY = 'integration-test-api-key';
const CONTAINER_NAME_PREFIXES = ['int-smoke-', 'commerce-int-', 'mdb-persist-'];

let dockerOk = false;
let app;
let tmpBase = '';
let templatesTmp = '';
let suffix = '';
let hostPort = 0;
const createdContainerIds = [];

function purgeServerCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}server${path.sep}`) || key.endsWith(`${path.sep}server${path.sep}index.js`)) {
      delete require.cache[key];
    }
  }
}

function setupIntegrationEnv() {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-docker-int-'));
  templatesTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-tpl-int-'));
  seedTemplatesDir(templatesTmp, DEFAULT_SEED_DIR);

  process.env.NODE_ENV = 'test';
  process.env.TEMPLATES_DIR = templatesTmp;
  process.env.TEMPLATES_BUNDLED_DIR = DEFAULT_SEED_DIR;
  process.env.DEPLOY_BASE_PATH = tmpBase;
  process.env.API_KEY = API_KEY;
  process.env.DEPLOYER_AUTH_MODE = 'api';
  process.env.ADMIN_USER = 'docker-int';
  process.env.ADMIN_PASSWORD = 'docker-int-pass';
  process.env.SESSION_SECRET = 'docker-int-secret';
  process.env.MANAGED_LABEL_VALUE = 'deployer-docker-int';
  process.env.CONTAINER_LIMIT = '0';
  purgeServerCache();
  return require('../../server/index.js');
}

function trackContainer(id) {
  if (id && !createdContainerIds.includes(id)) createdContainerIds.push(id);
}

describe('deployer docker integration', { concurrency: false }, () => {
  before(async () => {
    dockerOk = await isDockerAvailable();
    if (!dockerOk) return;
    suffix = `${Date.now().toString(36)}`;
    hostPort = await getFreePort();
    app = setupIntegrationEnv();
    resetForTests();
  });

  after(async () => {
    if (dockerOk) {
      await restoreIntegrationZeroState({
        containerIds: createdContainerIds,
        namePrefixes: CONTAINER_NAME_PREFIXES,
        restoreTemplates: false,
      });
    }
    if (tmpBase) {
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (_) {}
    }
    if (templatesTmp) {
      try { fs.rmSync(templatesTmp, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('manifest templates exist in bundled templates', () => {
    for (const entry of Object.values(manifest.templates)) {
      const filePath = path.join(DEFAULT_SEED_DIR, entry.file);
      assert.ok(fs.existsSync(filePath), `missing bundled template ${entry.file}`);
    }
  });

  it('deploys integration-smoke, lifecycle, and deletes container', async () => {
    assert.ok(dockerOk, 'Docker required (docker info). Use DEPLOYER_TEST_SKIP_DOCKER=1 only to skip via test script exclusion.');

    const spec = manifest.templates['integration-smoke'];
    const params = applyManifestParams(spec.deployParams, { suffix, hostPort });
    const containerName = applyManifestContainerName(spec.containerName, { suffix, hostPort });

    const deployRes = await request(app)
      .post('/api/deploy')
      .set('X-API-Key', API_KEY)
      .send({ templateId: 'integration-smoke', containerName, params });

    assert.strictEqual(deployRes.status, 202);
    assert.ok(deployRes.body.operation?.operationId);

    const deployOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      deployRes.body.operation.operationId,
      { delayMs: 800 },
    );

    assert.strictEqual(deployOp.status, 'succeeded');
    const containerId = deployOp.result?.container?.id;
    const deployedName = deployOp.result?.container?.name;
    assert.ok(containerId);
    trackContainer(containerId);
    assert.strictEqual(String(deployedName || ''), applyManifestContainerName(spec.expectedContainerName, { suffix, hostPort }));

    const getRes = await request(app)
      .get(`/api/containers/${encodeURIComponent(containerId)}`)
      .set('X-API-Key', API_KEY);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.state, 'running');
    assert.strictEqual(getRes.body.templateId, 'integration-smoke');
    assert.strictEqual(getRes.body.deployName, containerName);

    const stopOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      (await request(app).post(`/api/containers/${encodeURIComponent(containerId)}/stop`).set('X-API-Key', API_KEY)).body.operation.operationId,
      { delayMs: 800 },
    );
    assert.strictEqual(stopOp.status, 'succeeded');

    const startOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      (await request(app).post(`/api/containers/${encodeURIComponent(containerId)}/start`).set('X-API-Key', API_KEY)).body.operation.operationId,
      { delayMs: 800 },
    );
    assert.strictEqual(startOp.status, 'succeeded');

    const restartOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      (await request(app).post(`/api/containers/${encodeURIComponent(containerId)}/restart`).set('X-API-Key', API_KEY)).body.operation.operationId,
      { delayMs: 800 },
    );
    assert.strictEqual(restartOp.status, 'succeeded');

    const deleteRes = await request(app)
      .delete(`/api/containers/${encodeURIComponent(containerId)}`)
      .set('X-API-Key', API_KEY);
    assert.strictEqual(deleteRes.status, 202);

    const deleteOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      deleteRes.body.operation.operationId,
      { delayMs: 800 },
    );
    assert.strictEqual(deleteOp.status, 'succeeded');

    const idx = createdContainerIds.indexOf(containerId);
    if (idx >= 0) createdContainerIds.splice(idx, 1);

    const gone = await request(app)
      .get(`/api/containers/${encodeURIComponent(containerId)}`)
      .set('X-API-Key', API_KEY);
    assert.strictEqual(gone.status, 404);
  });

  it('rolls back container when deploy start fails (port conflict)', async () => {
    assert.ok(dockerOk, 'Docker required (docker info). Use DEPLOYER_TEST_SKIP_DOCKER=1 only to skip via test script exclusion.');

    resetForTests();
    const conflictPort = await getFreePort();
    const spec = manifest.templates['integration-smoke'];
    const nameA = `int-rollback-a-${suffix}`;
    const nameB = `int-rollback-b-${suffix}`;
    const params = applyManifestParams(spec.deployParams, { suffix, hostPort: conflictPort });

    const deployARes = await request(app)
      .post('/api/deploy')
      .set('X-API-Key', API_KEY)
      .send({ templateId: 'integration-smoke', containerName: nameA, params });
    assert.strictEqual(deployARes.status, 202);
    const deployAOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      deployARes.body.operation.operationId,
      { delayMs: 800 },
    );
    assert.strictEqual(deployAOp.status, 'succeeded');
    trackContainer(deployAOp.result?.container?.id);

    const deployBRes = await request(app)
      .post('/api/deploy')
      .set('X-API-Key', API_KEY)
      .send({ templateId: 'integration-smoke', containerName: nameB, params });
    assert.strictEqual(deployBRes.status, 202);
    let deployBOp = null;
    for (let i = 0; i < 60; i += 1) {
      const body = await request(app)
        .get(`/api/operations/${deployBRes.body.operation.operationId}`)
        .set('X-API-Key', API_KEY)
        .then((r) => r.body);
      const op = body.operation || body;
      if (op?.status === 'failed' || op?.status === 'succeeded') {
        deployBOp = op;
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    assert.ok(deployBOp, 'deploy B operation did not finish');
    assert.strictEqual(deployBOp.status, 'failed');

    const listRes = await request(app).get('/api/containers?all=true').set('X-API-Key', API_KEY);
    assert.strictEqual(listRes.status, 200);
    const foundB = (listRes.body.containers || []).find((c) => c.name === nameB);
    assert.equal(foundB, undefined, 'failed deploy must not leave orphan container on host');

    await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      (await request(app).delete(`/api/containers/${encodeURIComponent(deployAOp.result.container.id)}`).set('X-API-Key', API_KEY)).body.operation.operationId,
      { delayMs: 800 },
    );
    const idx = createdContainerIds.indexOf(deployAOp.result.container.id);
    if (idx >= 0) createdContainerIds.splice(idx, 1);
  });

  it('deploys docker-demo-free with containerName', async () => {
    assert.ok(dockerOk, 'Docker required (docker info). Use DEPLOYER_TEST_SKIP_DOCKER=1 only to skip via test script exclusion.');

    resetForTests();
    const localSuffix = `${suffix}-commerce`;
    const localPort = await getFreePort();
    const spec = manifest.templates['docker-demo-free'];
    const params = applyManifestParams(spec.deployParams, { suffix: localSuffix, hostPort: localPort });
    const containerName = applyManifestContainerName(spec.containerName, { suffix: localSuffix, hostPort: localPort });

    const deployRes = await request(app)
      .post('/api/deploy')
      .set('X-API-Key', API_KEY)
      .send({ templateId: 'docker-demo-free', containerName, params });

    assert.strictEqual(deployRes.status, 202);
    const deployOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      deployRes.body.operation.operationId,
      { delayMs: 1500, maxAttempts: 240 },
    );

    assert.strictEqual(deployOp.status, 'succeeded');
    assert.strictEqual(deployOp.result?.container?.name, containerName);

    const containerId = deployOp.result.container.id;
    trackContainer(containerId);
    await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      (await request(app).delete(`/api/containers/${encodeURIComponent(containerId)}`).set('X-API-Key', API_KEY)).body.operation.operationId,
      { delayMs: 800 },
    );
    const idx = createdContainerIds.indexOf(containerId);
    if (idx >= 0) createdContainerIds.splice(idx, 1);
  });

  it('mariadb redeploy with same containerName preserves bind mount (removeData=false)', async () => {
    assert.ok(dockerOk, 'Docker required (docker info). Use DEPLOYER_TEST_SKIP_DOCKER=1 only to skip via test script exclusion.');

    resetForTests();
    const localSuffix = `${suffix}-mdb`;
    const localPort = await getFreePort();
    const containerName = `mdb-persist-${localSuffix}`;
    const params = {
      HOST_PORT: String(localPort),
      MARIADB_USER: 'wp',
      MARIADB_PASSWORD: 'secret_pass_123',
      MARIADB_DATABASE: 'wordpress',
      MARIADB_ROOT_PASSWORD: 'root_pass_123',
    };

    const deployRes = await request(app)
      .post('/api/deploy')
      .set('X-API-Key', API_KEY)
      .send({ templateId: 'mariadb', containerName, params });

    assert.strictEqual(deployRes.status, 202);
    const deployOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      deployRes.body.operation.operationId,
      { delayMs: 2000, maxAttempts: 300 },
    );

    assert.strictEqual(deployOp.status, 'succeeded');
    const containerId = deployOp.result?.container?.id;
    const deployedName = deployOp.result?.container?.name;
    assert.ok(containerId);
    assert.strictEqual(deployedName, containerName);
    trackContainer(containerId);

    const dataDir = path.join(tmpBase, 'instances', containerName, 'data');
    const markerContent = 'tier-change-keeps-data';
    const containerMarker = '/var/lib/mysql/persist-marker.txt';
    writeFileInContainer(containerId, containerMarker, markerContent);

    const deleteRes = await request(app)
      .delete(`/api/containers/${encodeURIComponent(containerId)}?removeData=false`)
      .set('X-API-Key', API_KEY);
    assert.strictEqual(deleteRes.status, 202);
    const deleteOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      deleteRes.body.operation.operationId,
      { delayMs: 1500, maxAttempts: 240 },
    );
    assert.strictEqual(deleteOp.status, 'succeeded');

    const idx = createdContainerIds.indexOf(containerId);
    if (idx >= 0) createdContainerIds.splice(idx, 1);

    const redeployRes = await request(app)
      .post('/api/deploy')
      .set('X-API-Key', API_KEY)
      .send({ templateId: 'mariadb', containerName, params });
    assert.strictEqual(redeployRes.status, 202);
    const redeployOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      redeployRes.body.operation.operationId,
      { delayMs: 2000, maxAttempts: 300 },
    );

    assert.strictEqual(redeployOp.status, 'succeeded');
    assert.strictEqual(redeployOp.result?.container?.name, containerName);
    const redeployedId = redeployOp.result.container.id;
    assert.strictEqual(readFileInContainer(redeployedId, containerMarker), markerContent);
    const markerPath = path.join(dataDir, 'persist-marker.txt');
    if (fs.existsSync(markerPath)) {
      assert.strictEqual(fs.readFileSync(markerPath, 'utf8'), markerContent);
    }
    trackContainer(redeployedId);
  });

  it('docker-demo plan change (free→basic) preserves containerName and demo-data volume', async () => {
    assert.ok(dockerOk, 'Docker required (docker info). Use DEPLOYER_TEST_SKIP_DOCKER=1 only to skip via test script exclusion.');

    resetForTests();
    const localSuffix = `${suffix}-tier`;
    const localPort = await getFreePort();
    const containerName = `demo-tier-${localSuffix}`;
    const params = { HOST_PORT: String(localPort) };

    async function deployTemplate(templateId) {
      const deployRes = await request(app)
        .post('/api/deploy')
        .set('X-API-Key', API_KEY)
        .send({ templateId, containerName, params });
      assert.strictEqual(deployRes.status, 202);
      return pollOperation(
        (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
        deployRes.body.operation.operationId,
        { delayMs: 1500, maxAttempts: 240 },
      );
    }

    const freeOp = await deployTemplate('docker-demo-free');
    assert.strictEqual(freeOp.status, 'succeeded');
    const freeContainerId = freeOp.result?.container?.id;
    const freeName = freeOp.result?.container?.name;
    assert.ok(freeContainerId);
    assert.ok(String(freeName || '').includes(containerName));
    trackContainer(freeContainerId);

    const dataDir = path.join(tmpBase, 'instances', containerName, 'demo-data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'tier.txt'), 'survives-plan-change', 'utf8');

    const deleteRes = await request(app)
      .delete(`/api/containers/${encodeURIComponent(freeContainerId)}?removeData=false`)
      .set('X-API-Key', API_KEY);
    assert.strictEqual(deleteRes.status, 202);
    const deleteOp = await pollOperation(
      (id) => request(app).get(`/api/operations/${id}`).set('X-API-Key', API_KEY).then((r) => r.body),
      deleteRes.body.operation.operationId,
      { delayMs: 1500, maxAttempts: 240 },
    );
    assert.strictEqual(deleteOp.status, 'succeeded');
    const freeIdx = createdContainerIds.indexOf(freeContainerId);
    if (freeIdx >= 0) createdContainerIds.splice(freeIdx, 1);

    const basicOp = await deployTemplate('docker-demo-basic');
    assert.strictEqual(basicOp.status, 'succeeded');
    const basicName = basicOp.result?.container?.name;
    assert.strictEqual(basicName, freeName, 'plan change must keep same container name');
    assert.ok(fs.existsSync(path.join(dataDir, 'tier.txt')));
    assert.strictEqual(fs.readFileSync(path.join(dataDir, 'tier.txt'), 'utf8'), 'survives-plan-change');
    trackContainer(basicOp.result.container.id);
  });
});
