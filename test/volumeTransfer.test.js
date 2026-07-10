const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpBase = path.join(os.tmpdir(), `vol-xfer-${Date.now()}`);
process.env.DEPLOY_BASE_PATH = tmpBase;

const {
  createImportSession,
  consumeImportToken,
  getVolumeManifest,
  instanceDataDir,
  packDirectory,
  unpackArchive,
  resetImportSessionsForTests,
} = require('../server/volumeTransfer');

test('import-session + manifest + unpack roundtrip', async () => {
  resetImportSessionsForTests();
  const containerName = 'testinst01';
  const srcDir = instanceDataDir(containerName);
  fs.mkdirSync(path.join(srcDir, 'demo-data'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'demo-data', 'hello.txt'), 'placement-volume');

  const manifest = getVolumeManifest(containerName);
  assert.ok(manifest.paths.includes('demo-data'));
  assert.ok(manifest.size_bytes > 0);

  const session = createImportSession(containerName);
  assert.ok(session.importToken);
  assert.ok(session.expiresAt);

  const destName = 'testinst02';
  const destDir = instanceDataDir(destName);
  fs.mkdirSync(destDir, { recursive: true });

  const archive = await packDirectory(srcDir);
  await unpackArchive(archive, destDir);

  const copied = path.join(destDir, 'demo-data', 'hello.txt');
  assert.ok(fs.existsSync(copied));
  assert.equal(fs.readFileSync(copied, 'utf8'), 'placement-volume');

  assert.equal(consumeImportToken(session.importToken, containerName), true);
  assert.equal(consumeImportToken(session.importToken, containerName), false);
});

test.after(() => {
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
