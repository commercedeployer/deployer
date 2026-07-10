const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpBase = path.join(os.tmpdir(), `vol-sync-${Date.now()}`);
process.env.DEPLOY_BASE_PATH = tmpBase;

const {
  syncVolumeToPeer,
  getVolumeManifest,
  instanceDataDir,
  volumeManifestsEquivalent,
  computeDeltaFilePaths,
  selectSyncPackMethod,
  peerFileMap,
  resetImportSessionsForTests,
} = require('../server/volumeTransfer');

test('volumeManifestsEquivalent compares size and mtime', () => {
  const a = { size_bytes: 100, mtime_max: '2026-01-01T00:00:00.000Z', file_count: 2 };
  const b = { size_bytes: 100, mtime_max: '2026-01-01T00:00:00.000Z', file_count: 2 };
  assert.equal(volumeManifestsEquivalent(a, b), true);
  assert.equal(volumeManifestsEquivalent(a, { ...b, size_bytes: 99 }), false);
});

test('computeDeltaFilePaths detects new and changed files', () => {
  const local = [
    { path: 'a.txt', size_bytes: 10, mtime_ms: 100 },
    { path: 'b.txt', size_bytes: 20, mtime_ms: 200 },
    { path: 'c.txt', size_bytes: 30, mtime_ms: 300 },
  ];
  const peer = peerFileMap({
    files: [
      { path: 'a.txt', size_bytes: 10, mtime_ms: 100 },
      { path: 'b.txt', size_bytes: 20, mtime_ms: 199 },
    ],
  });
  const delta = computeDeltaFilePaths(local, peer);
  assert.deepEqual(delta.sort(), ['b.txt', 'c.txt']);
});

test('selectSyncPackMethod prefers delta when few files changed', () => {
  const localFiles = Array.from({ length: 10 }, (_, i) => ({
    path: `f${i}.txt`,
    size_bytes: 1,
    mtime_ms: i,
  }));
  const peerManifest = { files: localFiles.map((f) => ({ ...f })) };
  const delta = ['f9.txt'];
  assert.equal(selectSyncPackMethod({ localFiles, peerManifest, deltaPaths: delta }), 'delta_tar');
  const bigDelta = localFiles.map((f) => f.path);
  assert.equal(selectSyncPackMethod({ localFiles, peerManifest, deltaPaths: bigDelta }), 'full_tar');
});

test('getVolumeManifest includes files with detail=1', () => {
  const containerName = 'detailinst';
  const dir = instanceDataDir(containerName);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'one.txt'), 'x');
  const brief = getVolumeManifest(containerName);
  assert.equal(brief.files, undefined);
  const detailed = getVolumeManifest(containerName, { detail: true });
  assert.ok(Array.isArray(detailed.files));
  assert.ok(detailed.files.some((f) => f.path === 'data/one.txt'));
});

test('syncVolumeToPeer uses delta_tar when peer has most files unchanged', async () => {
  resetImportSessionsForTests();
  const containerName = 'syncinst03';
  const srcDir = instanceDataDir(containerName);
  fs.mkdirSync(path.join(srcDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'data', 'stable.txt'), 'same');
  fs.writeFileSync(path.join(srcDir, 'data', 'changed.txt'), 'new-content');
  const localManifest = getVolumeManifest(containerName, { detail: true });
  const peerFiles = localManifest.files.map((f) =>
    f.path === 'data/changed.txt'
      ? { ...f, size_bytes: 1, mtime_ms: f.mtime_ms - 1000 }
      : { ...f },
  );
  const peerManifest = {
    size_bytes: localManifest.size_bytes - 5,
    mtime_max: '2020-01-01T00:00:00.000Z',
    file_count: localManifest.file_count,
    files: peerFiles,
  };

  const originalFetch = global.fetch;
  let uploadBody = null;
  global.fetch = async (url, opts) => {
    if (String(url).includes('/manifest')) {
      return { ok: true, json: async () => ({ ok: true, manifest: peerManifest }) };
    }
    uploadBody = opts?.body;
    return { ok: true, text: async () => '' };
  };

  try {
    const result = await syncVolumeToPeer({
      containerName,
      targetBaseUrl: 'http://peer-deployer',
      importToken: 'test-token',
      mode: 'quiesced',
    });
    assert.equal(result.skipped, false);
    assert.equal(result.sync_method, 'delta_tar');
    assert.equal(result.delta_files, 1);
    assert.ok(uploadBody && uploadBody.length > 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncVolumeToPeer uploads without removing container (no docker container present)', async () => {
  resetImportSessionsForTests();
  const containerName = 'syncinst01';
  const srcDir = instanceDataDir(containerName);
  fs.mkdirSync(path.join(srcDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'data', 'payload.txt'), 'replicate-sync-payload');

  const originalFetch = global.fetch;
  let uploadUrl = '';
  let uploadCalls = 0;
  global.fetch = async (url, opts) => {
    if (String(url).includes('/manifest')) {
      return { ok: true, json: async () => ({ ok: true, manifest: { size_bytes: 0 } }) };
    }
    uploadCalls += 1;
    uploadUrl = String(url);
    return { ok: true, text: async () => '' };
  };

  try {
    const result = await syncVolumeToPeer({
      containerName,
      targetBaseUrl: 'http://peer-deployer',
      importToken: 'test-token',
      mode: 'quiesced',
    });
    assert.equal(result.container_preserved, true);
    assert.equal(result.mode, 'quiesced');
    assert.equal(result.skipped, false);
    assert.ok(result.bytes_transferred > 0);
    assert.ok(result.duration_ms >= 0);
    assert.ok(uploadUrl.includes('/api/volumes/syncinst01/import-stream'));
    assert.ok(fs.existsSync(path.join(srcDir, 'data', 'payload.txt')));
    assert.equal(uploadCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncVolumeToPeer skips upload when peer manifest matches', async () => {
  resetImportSessionsForTests();
  const containerName = 'syncinst02';
  const srcDir = instanceDataDir(containerName);
  fs.mkdirSync(path.join(srcDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'data', 'same.txt'), 'unchanged');
  const localManifest = getVolumeManifest(containerName);

  const originalFetch = global.fetch;
  let uploadCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('/manifest')) {
      return { ok: true, json: async () => ({ ok: true, manifest: localManifest }) };
    }
    uploadCalls += 1;
    return { ok: true, text: async () => '' };
  };

  try {
    const result = await syncVolumeToPeer({
      containerName,
      targetBaseUrl: 'http://peer-deployer',
      importToken: 'test-token',
      mode: 'quiesced',
    });
    assert.equal(result.skipped, true);
    assert.equal(result.skip_reason, 'manifest_unchanged');
    assert.equal(result.bytes_transferred, 0);
    assert.equal(uploadCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test.after(() => {
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
