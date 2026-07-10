/**
 * Volume export/import/transfer under DEPLOY_BASE_PATH/containerName.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getContainer, stopAndRemoveContainer, restartContainer, stopContainer, startContainer, CONTAINER_LIMIT } = require('./docker');
const { INSTANCE_LABEL } = require('./deployIdentity');
const { normalizeDockerContainerName } = require('./deployIdentity');

const IMPORT_TTL_MS = 30 * 60 * 1000;
/** Max file entries in manifest when detail=1 (sync delta). */
const MANIFEST_FILES_CAP = 50_000;
/** When changed files are >= this fraction of total, full tar is cheaper than delta. */
const DELTA_FULL_THRESHOLD = 0.8;
/** @type {Map<string, { containerName: string, expiresAt: number }>} */
const importSessions = new Map();

function outboundDeployerApiKey() {
  return String(process.env.API_KEY || process.env.DEPLOYER_API_KEY || '').trim();
}

function deployBasePath() {
  return path.resolve(process.env.DEPLOY_BASE_PATH || '/opt/deploy-data');
}

function instanceDataDir(containerName) {
  const name = normalizeDockerContainerName(containerName);
  const base = deployBasePath();
  const dir = path.resolve(base, name);
  if (!dir.startsWith(base + path.sep) && dir !== base) {
    throw new Error('invalid_container_name');
  }
  return dir;
}

function sweepImportSessions() {
  const now = Date.now();
  for (const [token, sess] of importSessions) {
    if (sess.expiresAt <= now) importSessions.delete(token);
  }
}

function createImportSession(containerName) {
  sweepImportSessions();
  const name = normalizeDockerContainerName(containerName);
  const dir = instanceDataDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const importToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + IMPORT_TTL_MS;
  importSessions.set(importToken, { containerName: name, expiresAt });
  return { importToken, expiresAt: new Date(expiresAt).toISOString() };
}

function consumeImportToken(token, containerName) {
  sweepImportSessions();
  const key = String(token || '').trim();
  const sess = importSessions.get(key);
  if (!sess) return false;
  if (sess.containerName !== normalizeDockerContainerName(containerName)) return false;
  if (sess.expiresAt <= Date.now()) {
    importSessions.delete(key);
    return false;
  }
  importSessions.delete(key);
  return true;
}

/** Validate token without consuming (for streaming import). */
function peekImportToken(token, containerName) {
  sweepImportSessions();
  const key = String(token || '').trim();
  const sess = importSessions.get(key);
  if (!sess) return false;
  if (sess.containerName !== normalizeDockerContainerName(containerName)) return false;
  if (sess.expiresAt <= Date.now()) {
    importSessions.delete(key);
    return false;
  }
  return true;
}

function volumeManifestsEquivalent(localManifest, remoteManifest) {
  const a = localManifest || {};
  const b = remoteManifest || {};
  const sizeA = Number(a.size_bytes) || 0;
  const sizeB = Number(b.size_bytes) || 0;
  if (sizeA <= 0 || sizeB <= 0) return false;
  if (sizeA !== sizeB) return false;
  if (a.mtime_max && b.mtime_max) return a.mtime_max === b.mtime_max;
  const fcA = Number(a.file_count) || 0;
  const fcB = Number(b.file_count) || 0;
  return fcA > 0 && fcA === fcB;
}

function dirSizeBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* skip */
        }
      }
    }
  }
  return total;
}

/** @returns {{ path: string, size_bytes: number, mtime_ms: number }[]} */
function listVolumeFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const base = path.resolve(dir);
  const stack = [base];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) {
        try {
          const st = fs.statSync(p);
          const rel = path.relative(base, p).split(path.sep).join('/');
          files.push({
            path: rel,
            size_bytes: st.size,
            mtime_ms: Math.floor(st.mtimeMs),
          });
        } catch {
          /* skip */
        }
      }
    }
  }
  return files;
}

function peerFileMap(peerManifest) {
  const map = new Map();
  for (const f of peerManifest?.files || []) {
    if (f?.path) map.set(f.path, f);
  }
  return map;
}

/** Paths on local that differ from peer (new, size, or mtime). */
function computeDeltaFilePaths(localFiles, peerMap) {
  const delta = [];
  for (const f of localFiles) {
    const p = peerMap.get(f.path);
    if (!p) {
      delta.push(f.path);
      continue;
    }
    if (Number(p.size_bytes) !== Number(f.size_bytes)) {
      delta.push(f.path);
      continue;
    }
    if (Number(p.mtime_ms) !== Number(f.mtime_ms)) {
      delta.push(f.path);
    }
  }
  return delta;
}

function selectSyncPackMethod({ localFiles, peerManifest, deltaPaths }) {
  const total = localFiles.length;
  if (total === 0) return 'full_tar';
  const peerFiles = peerManifest?.files;
  if (!Array.isArray(peerFiles) || peerFiles.length === 0) return 'full_tar';
  if (!deltaPaths.length) return 'full_tar';
  if (deltaPaths.length >= total * DELTA_FULL_THRESHOLD) return 'full_tar';
  return 'delta_tar';
}

function hostFromBaseUrl(baseUrl) {
  try {
    return new URL(String(baseUrl || '').trim()).hostname || null;
  } catch {
    return null;
  }
}

function getVolumeManifest(containerName, options = {}) {
  const detail = Boolean(options.detail);
  const dir = instanceDataDir(containerName);
  const paths = [];
  const files = listVolumeFiles(dir);
  let fileCount = files.length;
  let mtimeMax = 0;
  for (const f of files) {
    if (f.mtime_ms > mtimeMax) mtimeMax = f.mtime_ms;
  }
  if (fs.existsSync(dir)) {
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) paths.push(ent.name);
      }
    } catch {
      /* skip */
    }
  }
  const manifest = {
    containerName: normalizeDockerContainerName(containerName),
    basePath: dir,
    paths,
    size_bytes: files.reduce((sum, f) => sum + f.size_bytes, 0),
    file_count: fileCount,
    mtime_max: mtimeMax > 0 ? new Date(mtimeMax).toISOString() : null,
  };
  if (detail) {
    manifest.files = files.slice(0, MANIFEST_FILES_CAP);
    if (files.length > MANIFEST_FILES_CAP) {
      manifest.files_truncated = true;
    }
  }
  return manifest;
}

function runTarPack(sourceDir) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn('tar', ['-czf', '-', '-C', sourceDir, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (c) => chunks.push(c));
    let err = '';
    proc.stderr.on('data', (c) => {
      err += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(err || `tar pack exit ${code}`));
    });
  });
}

function runTarPackPaths(sourceDir, paths) {
  if (!paths.length) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn('tar', ['-czf', '-', '-C', sourceDir, ...paths], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (c) => chunks.push(c));
    let err = '';
    proc.stderr.on('data', (c) => {
      err += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(err || `tar pack paths exit ${code}`));
    });
  });
}

function runTarUnpack(buffer, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', '-', '-C', destDir], { stdio: ['pipe', 'inherit', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (c) => {
      err += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `tar unpack exit ${code}`));
    });
    proc.stdin.write(buffer);
    proc.stdin.end();
  });
}

async function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDirRecursive(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

async function packDirectory(dir) {
  try {
    return await runTarPack(dir);
  } catch {
    /* fallback for dev without tar */
    const tmp = path.join(dir, '..', `.pack-${Date.now()}.bin`);
    await copyDirRecursive(dir, `${tmp}.data`);
    const marker = Buffer.from(JSON.stringify({ fallback: true, dir: `${tmp}.data` }));
    return marker;
  }
}

async function packDirectoryPaths(dir, paths) {
  if (!paths.length) return Buffer.alloc(0);
  try {
    return await runTarPackPaths(dir, paths);
  } catch {
    const tmp = path.join(dir, '..', `.pack-delta-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      for (const rel of paths) {
        const src = path.join(dir, rel);
        const dest = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
      return await runTarPack(tmp);
    } catch {
      return packDirectory(dir);
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function runTarUnpackStream(readable, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', '-', '-C', destDir], { stdio: ['pipe', 'inherit', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (c) => {
      err += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `tar unpack stream exit ${code}`));
    });
    readable.pipe(proc.stdin);
    readable.on('error', reject);
    proc.stdin.on('error', reject);
  });
}

async function fetchPeerVolumeManifest({ targetBaseUrl, containerName, detail = true }) {
  const base = String(targetBaseUrl || '').trim().replace(/\/$/, '');
  if (!base) return null;
  const name = encodeURIComponent(normalizeDockerContainerName(containerName));
  const detailQ = detail ? '?detail=1' : '';
  const url = `${base}/api/volumes/${name}/manifest${detailQ}`;
  const apiKey = outboundDeployerApiKey();
  const headers = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.manifest ?? body;
  } catch {
    return null;
  }
}
async function unpackArchive(buffer, destDir) {
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (parsed?.fallback && parsed.dir && fs.existsSync(parsed.dir)) {
      await copyDirRecursive(parsed.dir, destDir);
      fs.rmSync(parsed.dir, { recursive: true, force: true });
      return;
    }
  } catch {
    /* not json — tar gzip */
  }
  await runTarUnpack(buffer, destDir);
}

async function transferVolumeToTarget({ containerName, targetBaseUrl, importToken, onPhase }) {
  const name = normalizeDockerContainerName(containerName);
  const dir = instanceDataDir(name);
  const phase = typeof onPhase === 'function' ? onPhase : () => {};

  phase('quiescing', 'Stopping container if present');
  const existing = await getContainer(name);
  if (existing) {
    await stopAndRemoveContainer(name, false, { onPhase: phase });
  }

  phase('packing', 'Packing volume data');
  const archive = await packDirectory(dir);

  const base = String(targetBaseUrl || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('targetBaseUrl required');
  const url = `${base}/api/volumes/${encodeURIComponent(name)}/import-stream?token=${encodeURIComponent(importToken)}`;

  phase('uploading', 'Uploading to target');
  const apiKey = outboundDeployerApiKey();
  const headers = { 'content-type': 'application/gzip' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(url, { method: 'POST', headers, body: archive });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `import failed HTTP ${res.status}`);
  }

  phase('verifying', 'Transfer complete');
  return { containerName: name, bytes: archive.length };
}

async function uploadArchiveToPeer({ containerName, targetBaseUrl, importToken, archive, onPhase }) {
  const name = normalizeDockerContainerName(containerName);
  const phase = typeof onPhase === 'function' ? onPhase : () => {};
  const base = String(targetBaseUrl || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('targetBaseUrl required');
  const url = `${base}/api/volumes/${encodeURIComponent(name)}/import-stream?token=${encodeURIComponent(importToken)}`;
  phase('uploading', 'Uploading to target');
  const apiKey = outboundDeployerApiKey();
  const headers = { 'content-type': 'application/gzip' };
  if (apiKey) headers['x-api-key'] = apiKey;
  const res = await fetch(url, { method: 'POST', headers, body: archive });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `import failed HTTP ${res.status}`);
  }
  return { containerName: name, bytes: archive.length };
}

function parseRsyncStatsBytes(stderr) {
  const text = String(stderr || '');
  const m = text.match(/Total transferred file size:\s*([\d,]+)/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, '')) || null;
}

/**
 * Optional native rsync over SSH when DEPLOYER_VOLUME_RSYNC_SSH=1 (same DEPLOY_BASE_PATH on peers).
 */
async function tryRsyncOverSsh({ dir, containerName, targetBaseUrl, phase }) {
  if (process.env.DEPLOYER_VOLUME_RSYNC_SSH !== '1') return null;
  const host = hostFromBaseUrl(targetBaseUrl);
  if (!host) return null;
  const user = String(process.env.DEPLOYER_RSYNC_SSH_USER || 'root').trim() || 'root';
  const remoteDir = instanceDataDir(containerName);
  const sshKey = String(process.env.DEPLOYER_RSYNC_SSH_KEY || '').trim();
  const sshCmd = sshKey
    ? `ssh -i ${sshKey} -o StrictHostKeyChecking=accept-new`
    : 'ssh -o StrictHostKeyChecking=accept-new';
  const remote = `${user}@${host}:${remoteDir}/`;
  phase('rsync', 'Syncing via rsync over SSH');
  return new Promise((resolve) => {
    const args = ['-az', '--delete', '--stats', '-e', sshCmd, `${dir}/`, remote];
    const proc = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const bytes = parseRsyncStatsBytes(stderr);
      resolve({
        bytes: bytes != null ? bytes : dirSizeBytes(dir),
        sync_method: 'rsync_ssh',
      });
    });
  });
}

/**
 * Replicate volume to peer without removing the source container (quiesced: stop → pack → upload → start).
 */
async function syncVolumeToPeer({ containerName, targetBaseUrl, importToken, mode = 'quiesced', onPhase }) {
  const started = Date.now();
  const name = normalizeDockerContainerName(containerName);
  const dir = instanceDataDir(name);
  const phase = typeof onPhase === 'function' ? onPhase : () => {};
  const syncMode = String(mode || 'quiesced').trim() === 'hot' ? 'hot' : 'quiesced';
  const localManifest = getVolumeManifest(name);
  const peerManifest = await fetchPeerVolumeManifest({ targetBaseUrl, containerName: name, detail: true });
  if (volumeManifestsEquivalent(localManifest, peerManifest)) {
    phase('skipped', 'Peer already has matching volume manifest');
    return {
      containerName: name,
      bytes: 0,
      bytes_transferred: 0,
      mode: syncMode,
      container_preserved: true,
      skipped: true,
      skip_reason: 'manifest_unchanged',
      sync_method: 'skip',
      duration_ms: Date.now() - started,
    };
  }

  const existing = await getContainer(name);
  const hadContainer = Boolean(existing);

  if (syncMode === 'quiesced' && hadContainer) {
    phase('quiescing', 'Stopping container for consistent sync');
    await stopContainer(name, { onPhase: phase });
  }

  const rsyncResult = await tryRsyncOverSsh({ dir, containerName: name, targetBaseUrl, phase });
  if (rsyncResult) {
    if (syncMode === 'quiesced' && hadContainer) {
      phase('resuming', 'Starting container after sync');
      await startContainer(name, { onPhase: phase });
    }
    return {
      containerName: name,
      bytes: rsyncResult.bytes,
      bytes_transferred: rsyncResult.bytes,
      mode: syncMode,
      container_preserved: true,
      skipped: false,
      sync_method: rsyncResult.sync_method,
      duration_ms: Date.now() - started,
    };
  }

  const localFiles = listVolumeFiles(dir);
  const peerMap = peerFileMap(peerManifest);
  const deltaPaths = computeDeltaFilePaths(localFiles, peerMap);
  const packMethod = selectSyncPackMethod({ localFiles, peerManifest, deltaPaths });

  let archive;
  let syncMethod;
  if (packMethod === 'delta_tar') {
    phase('packing', `Packing ${deltaPaths.length} changed file(s)`);
    archive = await packDirectoryPaths(dir, deltaPaths);
    syncMethod = 'delta_tar';
  } else {
    phase('packing', 'Packing full volume data');
    archive = await packDirectory(dir);
    syncMethod = 'full_tar';
  }

  const uploaded = await uploadArchiveToPeer({
    containerName: name,
    targetBaseUrl,
    importToken,
    archive,
    onPhase: phase,
  });

  if (syncMode === 'quiesced' && hadContainer) {
    phase('resuming', 'Starting container after sync');
    await startContainer(name, { onPhase: phase });
  }

  return {
    containerName: name,
    bytes: uploaded.bytes,
    bytes_transferred: uploaded.bytes,
    mode: syncMode,
    container_preserved: true,
    skipped: false,
    sync_method: syncMethod,
    delta_files: packMethod === 'delta_tar' ? deltaPaths.length : undefined,
    duration_ms: Date.now() - started,
  };
}

function resetImportSessionsForTests() {
  importSessions.clear();
}

module.exports = {
  createImportSession,
  consumeImportToken,
  peekImportToken,
  getVolumeManifest,
  listVolumeFiles,
  peerFileMap,
  computeDeltaFilePaths,
  selectSyncPackMethod,
  instanceDataDir,
  packDirectory,
  packDirectoryPaths,
  unpackArchive,
  runTarUnpackStream,
  volumeManifestsEquivalent,
  fetchPeerVolumeManifest,
  transferVolumeToTarget,
  syncVolumeToPeer,
  uploadArchiveToPeer,
  resetImportSessionsForTests,
};
