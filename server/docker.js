/**
 * Start and remove containers (Docker API).
 * With removeData, only directories under DEPLOY_BASE_PATH are deleted.
 */
const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');
const Docker = require('dockerode');
const { authconfigForRegistryPull } = require('./registry-auth');
const { INSTANCE_LABEL, TEMPLATE_LABEL, normalizeDockerContainerName } = require('./deployIdentity');
const { toDockerRestartPolicy } = require('./restartPolicy');
const { applyContainerRuntimeSpec } = require('./dockerSpec');
const { validateVolumePaths, applyVolumesToHostConfig, bindHostPaths } = require('./volumes');
const { applyNetworksToCreateOpts } = require('./networks');

function resolveDockerSocketPath() {
  const raw = (process.env.DOCKER_HOST || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('unix://')) return raw.slice('unix://'.length);
  if (raw.includes('://')) return undefined;
  return raw;
}

const dockerSocketPath = resolveDockerSocketPath();
const docker = dockerSocketPath ? new Docker({ socketPath: dockerSocketPath }) : new Docker();
const DEPLOY_BASE_PATH = (process.env.DEPLOY_BASE_PATH || '/opt/deploy-data').replace(/\/+$/, '');
const DEPLOY_BASE_PATH_RESOLVED = path.resolve(DEPLOY_BASE_PATH);
/** Managed container label: app controls only containers with this label. Set MANAGED_LABEL / MANAGED_LABEL_VALUE per instance on shared hosts. */
const MANAGED_LABEL = (process.env.MANAGED_LABEL || 'managed-by').trim() || 'managed-by';
const MANAGED_LABEL_VALUE = (process.env.MANAGED_LABEL_VALUE || 'deployer').trim() || 'deployer';
const CONTAINER_LIMIT = Math.max(0, parseInt(process.env.CONTAINER_LIMIT || '0', 10)) || 0;

function isPathUnderBase(hostPath) {
  if (!hostPath) return false;
  const resolved = path.resolve(hostPath);
  return resolved === DEPLOY_BASE_PATH_RESOLVED || resolved.startsWith(DEPLOY_BASE_PATH_RESOLVED + path.sep);
}

function validateVolumePathsForSpec(volumes) {
  validateVolumePaths(volumes, DEPLOY_BASE_PATH_RESOLVED);
}

function hasManagedLabel(containerInspect) {
  const labels = containerInspect.Config?.Labels || {};
  return labels[MANAGED_LABEL] === MANAGED_LABEL_VALUE;
}

/** Shared Docker socket: container may carry another replica's managed-by label but same deploy identity. */
async function findContainerInspectByDeployIdentity(idOrName) {
  const wanted = String(idOrName || '').trim().replace(/^\//, '');
  if (!wanted) return null;
  let normalized = wanted;
  try {
    normalized = normalizeDockerContainerName(wanted);
  } catch {
    // keep wanted
  }
  const list = await docker.listContainers({ all: true });
  for (const row of list) {
    const name = (row.Names || [])[0]?.replace(/^\//, '') || '';
    const labels = row.Labels || {};
    const deployName = String(labels[INSTANCE_LABEL] || '').trim();
    const match =
      name === wanted ||
      name === normalized ||
      deployName === wanted ||
      deployName === normalized;
    if (!match || !deployName) continue;
    try {
      return await docker.getContainer(row.Id).inspect();
    } catch {
      continue;
    }
  }
  return null;
}

function isManagedOrSharedPoolContainer(containerInspect, idOrName) {
  if (!containerInspect) return false;
  if (hasManagedLabel(containerInspect)) return true;
  const labels = containerInspect.Config?.Labels || {};
  const deployName = String(labels[INSTANCE_LABEL] || '').trim();
  if (!deployName) return false;
  const wanted = String(idOrName || '').trim().replace(/^\//, '');
  let normalized = wanted;
  try {
    normalized = normalizeDockerContainerName(wanted);
  } catch {
    // keep wanted
  }
  const name = containerInspect.Name?.replace(/^\//, '') || '';
  return (
    name === wanted ||
    name === normalized ||
    deployName === wanted ||
    deployName === normalized
  );
}

async function getContainerCount() {
  const list = await listContainers(true);
  return list.length;
}

function normalizePullPolicy(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'ifnotpresent' || v === 'if-not-present') return 'ifNotPresent';
  return 'always';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePullAttempts(value) {
  const n = parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return n;
}

async function ensureImagePresent(image, pullPolicyRaw) {
  const pullPolicy = normalizePullPolicy(pullPolicyRaw || process.env.DEFAULT_PULL_POLICY || 'always');
  const pullAttempts = normalizePullAttempts(process.env.PULL_MAX_ATTEMPTS || '3');
  if (pullPolicy === 'ifNotPresent') {
    try {
      await docker.getImage(image).inspect();
      return;
    } catch {
      // need to pull image
    }
  }
  const auth = authconfigForRegistryPull(image, process.env);
  const pullOpts = auth ? { authconfig: auth } : {};
  let lastErr = null;
  for (let attempt = 1; attempt <= pullAttempts; attempt++) {
    try {
      const stream = await docker.pull(image, pullOpts);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < pullAttempts) await sleep(1200);
    }
  }

  // Default behavior: if pull failed (auth/network/registry), but local image exists,
  // continue deployment using local cached image.
  try {
    await docker.getImage(image).inspect();
    console.warn(`Image pull failed for ${image}, using local image instead: ${lastErr?.message || 'pull error'}`);
    return;
  } catch {
    // no local image, propagate original pull error
  }
  throw lastErr || new Error(`Failed to pull image: ${image}`);
}

async function waitForHealthy(container, timeoutSec, onPhase) {
  const timeout = Math.max(5, parseInt(String(timeoutSec || '120'), 10) || 120);
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    const info = await container.inspect();
    const health = info.State?.Health?.Status;
    if (!health) {
      onPhase('wait_healthy_skipped', 'No healthcheck configured, skip wait');
      return;
    }
    if (health === 'healthy') {
      onPhase('wait_healthy_ok', 'Container is healthy');
      return;
    }
    if (health === 'unhealthy') {
      throw new Error('Container became unhealthy before deploy completed');
    }
    onPhase('wait_healthy', `Waiting for healthy (${health})`);
    await sleep(1500);
  }
  throw new Error(`Timeout waiting for healthy (${timeout}s)`);
}

async function createAndStart(spec, hooks = {}) {
  const onPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : () => {};
  onPhase('validating', 'Validating deployment spec');
  validateVolumePathsForSpec(spec.volumes);
  if (CONTAINER_LIMIT > 0) {
    const count = await getContainerCount();
    if (count >= CONTAINER_LIMIT) {
      throw new Error(`Container limit reached: ${count} / ${CONTAINER_LIMIT}. Remove containers or increase CONTAINER_LIMIT.`);
    }
  }
  onPhase('pulling_image', `Pulling image ${spec.image}`);
  await ensureImagePresent(spec.image, spec.pullPolicy);
  onPhase('preparing_volumes', 'Preparing volume directories');
  for (const hostPart of bindHostPaths(spec.volumes || [])) {
    if (hostPart && isPathUnderBase(path.resolve(hostPart))) {
      try {
        fs.mkdirSync(hostPart, { recursive: true });
      } catch {
        // directory exists or permission denied
      }
    }
  }
  const hostConfig = {
    PortBindings: {},
    RestartPolicy: toDockerRestartPolicy(spec.restartPolicy, spec.restartMaxRetries),
  };
  applyVolumesToHostConfig(hostConfig, spec.volumes);
  const createOpts = {
    Image: spec.image,
    name: spec.name,
    Env: spec.env.map((e) => `${e.name}=${e.value}`),
    HostConfig: hostConfig,
    Labels: { [MANAGED_LABEL]: MANAGED_LABEL_VALUE },
  };
  if (spec.platform) createOpts.Platform = spec.platform;
  applyNetworksToCreateOpts(createOpts, hostConfig, spec.networks, spec.network);
  const deployName = typeof hooks.deployName === 'string' ? hooks.deployName.trim() : '';
  if (deployName) createOpts.Labels[INSTANCE_LABEL] = deployName;
  const templateId = typeof hooks.templateId === 'string' ? hooks.templateId.trim() : '';
  if (templateId) createOpts.Labels[TEMPLATE_LABEL] = templateId;

  function portProtocol(p) {
    const proto = String(p.protocol || 'tcp').trim().toLowerCase();
    return proto === 'udp' ? 'udp' : 'tcp';
  }
  const portList = Array.isArray(spec.ports) ? spec.ports : [];
  if (portList.length === 0 && spec.publishPort && spec.port) {
    portList.push({
      containerPort: spec.containerPort || 80,
      hostPort: String(spec.port),
      protocol: 'tcp',
    });
  }
  for (const p of portList) {
    const proto = portProtocol(p);
    const containerPort = p.containerPort;
    if (!containerPort) continue;
    const key = `${containerPort}/${proto}`;
    if (p.hostPort) {
      hostConfig.PortBindings[key] = [{ HostPort: String(p.hostPort) }];
    } else {
      createOpts.ExposedPorts = createOpts.ExposedPorts || {};
      createOpts.ExposedPorts[key] = {};
    }
  }

  for (const label of spec.labels || []) {
    const s = typeof label === 'string' ? label : `${label.name}=${label.value}`;
    const eq = s.indexOf('=');
    if (eq > 0) {
      createOpts.Labels[s.slice(0, eq).trim()] = s.slice(eq + 1).trim();
    }
  }
  applyContainerRuntimeSpec(createOpts, hostConfig, spec);
  onPhase('creating_container', 'Creating container');
  let container = null;
  try {
    container = await docker.createContainer(createOpts);

    onPhase('starting_container', 'Starting container');
    await container.start();
    if (spec.waitHealthy) {
      await waitForHealthy(container, spec.waitHealthyTimeoutSec, onPhase);
    }
    const inspected = await container.inspect();
    return {
      id: container.id,
      name: inspected.Name.replace(/^\//, ''),
      state: inspected.State?.Status,
    };
  } catch (err) {
    const identity = deployName || spec.name;
    if (err.statusCode === 409 && identity) {
      const existing = await findContainerInspectByDeployIdentity(identity);
      if (existing) {
        onPhase('adopting_existing_container', 'Container already exists, adopting');
        const adopted = docker.getContainer(existing.Id);
        const state = existing.State?.Status;
        if (state !== 'running') {
          onPhase('starting_container', 'Starting container');
          await adopted.start();
        }
        if (spec.waitHealthy) {
          await waitForHealthy(adopted, spec.waitHealthyTimeoutSec, onPhase);
        }
        const inspected = await adopted.inspect();
        return {
          id: inspected.Id,
          name: inspected.Name.replace(/^\//, ''),
          state: inspected.State?.Status,
        };
      }
    }
    if (container) {
      try {
        await container.remove({ force: true });
      } catch (cleanupErr) {
        console.warn('Deploy rollback: remove container failed:', cleanupErr.message);
      }
    }
    throw err;
  }
}

async function listContainers(all = false) {
  const opts = { all, filters: { label: [`${MANAGED_LABEL}=${MANAGED_LABEL_VALUE}`] } };
  const list = await docker.listContainers(opts);
  return list.map((c) => ({
    id: c.Id,
    name: (c.Names || [])[0]?.replace(/^\//, '') || '',
    image: c.Image,
    state: c.State,
    deployName: (c.Labels || {})[INSTANCE_LABEL] || '',
    templateId: (c.Labels || {})[TEMPLATE_LABEL] || '',
  }));
}

async function getContainer(idOrName) {
  let container = null;
  try {
    container = await docker.getContainer(idOrName).inspect();
  } catch {
    container = await findContainerInspectByDeployIdentity(idOrName);
  }
  if (container && !isManagedOrSharedPoolContainer(container, idOrName)) return null;
  return container;
}

function removeDeployDataDir(containerName) {
  let name;
  try {
    name = normalizeDockerContainerName(containerName);
  } catch {
    return [];
  }
  const dir = path.resolve(DEPLOY_BASE_PATH_RESOLVED, name);
  if (!isPathUnderBase(dir)) return [];
  if (!fs.existsSync(dir)) return [];
  fs.rmSync(dir, { recursive: true, force: true });
  return [dir];
}

function removeContainerData(containerInspect) {
  const mounts = containerInspect.Mounts || [];
  const removed = [];
  for (const m of mounts) {
    const source = m.Source || m.Name;
    if (!source) continue;
    if (!isPathUnderBase(source)) continue;
    try {
      if (fs.existsSync(source)) {
        fs.rmSync(source, { recursive: true, force: true });
        removed.push(source);
      }
    } catch (e) {
      console.warn('Remove path failed:', source, e.message);
    }
  }
  return removed;
}

async function stopAndRemoveContainer(idOrName, removeData = false, hooks = {}) {
  const onPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : () => {};
  const container = await getContainer(idOrName);
  if (!container) {
    let dataRemoved = [];
    if (removeData) {
      onPhase('removing_data', 'Removing container data');
      const purgeId = hooks.deployId || idOrName;
      dataRemoved = removeDeployDataDir(purgeId);
    }
    onPhase('succeeded', removeData ? 'Data removed' : 'Already removed');
    return { removed: false, alreadyGone: true, dataRemoved };
  }
  onPhase('stopping_container', 'Stopping container');
  const id = container.Id;
  const c = docker.getContainer(id);
  try {
    await c.stop({ t: 10 });
  } catch (e) {
    if (e.statusCode !== 304) console.warn('Stop:', e.message);
  }
  let dataRemoved = [];
  if (removeData) {
    onPhase('removing_data', 'Removing container data');
    dataRemoved = removeContainerData(container);
    const deployName = (container.Config?.Labels || {})[INSTANCE_LABEL] || idOrName;
    const fromDir = removeDeployDataDir(deployName);
    dataRemoved = [...new Set([...dataRemoved, ...fromDir])];
  }
  onPhase('removing_container', 'Removing container');
  await c.remove({ force: true });
  onPhase('succeeded', 'Container removed');
  return { removed: true, alreadyGone: false, dataRemoved };
}

function readStatsFrames(stream, count = 2) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stream.destroy();
      reject(new Error('Stats stream timeout'));
    }, 15000);
    let buffer = '';
    const frames = [];
    function tryParse() {
      const idx = buffer.indexOf('\n');
      const line = idx >= 0 ? buffer.slice(0, idx).trim() : buffer.trim();
      if (idx >= 0) buffer = buffer.slice(idx + 1);
      else if (!line || line[0] !== '{') return;
      if (!line) return tryParse();
      try {
        const obj = JSON.parse(line);
        frames.push(obj);
        if (idx < 0) buffer = '';
        if (frames.length >= count) {
          clearTimeout(timeout);
          stream.destroy();
          resolve(frames);
        }
      } catch (e) {
        if (idx < 0) return;
      }
      if (frames.length < count && buffer.length) tryParse();
    }
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      tryParse();
    });
    stream.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** CPU% from one precpu_stats frame (interval set by daemon, like docker stats). */
function computeCpuPercentFromPrecpu(frame) {
  const cur = frame.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const sysCur = frame.cpu_stats?.system_cpu_usage ?? 0;
  const pre = frame.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const sysPre = frame.precpu_stats?.system_cpu_usage ?? 0;
  const cpuDelta = cur - pre;
  const sysDelta = sysCur - sysPre;
  if (sysDelta <= 0) return 0;
  const numCpus = frame.cpu_stats?.online_cpus ?? (frame.cpu_stats?.cpu_usage?.percpu_usage?.length) ?? 1;
  return (cpuDelta / sysDelta) * numCpus * 100;
}

function computeCpuPercent(frame1, frame2) {
  const cpu1 = frame1.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const sys1 = frame1.cpu_stats?.system_cpu_usage ?? 0;
  const cpu2 = frame2.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const sys2 = frame2.cpu_stats?.system_cpu_usage ?? 0;
  const cpuDelta = cpu2 - cpu1;
  const sysDelta = sys2 - sys1;
  if (sysDelta <= 0) return 0;
  const numCpus = frame2.cpu_stats?.online_cpus ?? (frame2.cpu_stats?.cpu_usage?.percpu_usage?.length) ?? 1;
  return (cpuDelta / sysDelta) * numCpus * 100;
}

const EXEC_TIMEOUT_MS = 25000;

/** Run command in container and return stdout. Container must be running. */
function execInContainer(container, cmd) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream = null;
    const done = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stream && typeof stream.destroy === 'function') stream.destroy();
      if (err) reject(err);
      else resolve(result);
    };
    const timer = setTimeout(() => done(new Error('Exec timeout')), EXEC_TIMEOUT_MS);
    const outChunks = [];
    const errChunks = [];
    const outW = new Writable({ write(chunk, enc, cb) { outChunks.push(chunk); cb(); } });
    const errW = new Writable({ write(chunk, enc, cb) { errChunks.push(chunk); cb(); } });

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, (err, exec) => {
      if (err) return done(err);
      exec.start({ Detach: false }, (err, s) => {
        if (err) return done(err);
        stream = s;
        container.modem.demuxStream(stream, outW, errW);
        stream.on('end', () => {
          outW.end();
          errW.end();
        });
        stream.on('error', done);
        outW.on('finish', () => done(null, Buffer.concat(outChunks).toString()));
      });
    });
  });
}

/** Container disk size: sum of du on mount paths (inside container) + SizeRw. */
async function getContainerDiskUsage(idOrName) {
  const containerInspect = await getContainer(idOrName);
  if (!containerInspect) return null;
  const state = containerInspect.State?.Status || 'unknown';

  const withSize = await docker.getContainer(containerInspect.Id).inspect({ size: true });
  const writableBytes = Math.max(0, withSize.SizeRw ?? 0);

  const baseHasColon = (process.env.DEPLOY_BASE_PATH || '').includes(':');
  const mounts = containerInspect.Mounts || [];
  const pathsToMeasure = [];
  for (const m of mounts) {
    const source = m.Source || m.Name;
    if (!source) continue;
    let include = isPathUnderBase(path.resolve(source));
    if (!include && baseHasColon) {
      const dest = (m.Destination || m.Target || '').trim();
      if (dest === '/var/hugo' || dest === '/var/lib/settings') include = true;
    }
    if (include) {
      const dest = (m.Destination || m.Target || '').trim();
      if (dest) pathsToMeasure.push(dest);
    }
  }

  let dataBytes = 0;
  if (state === 'running' && pathsToMeasure.length > 0) {
    const c = docker.getContainer(containerInspect.Id);
    for (const destPath of pathsToMeasure) {
      try {
        const out = await execInContainer(c, ['du', '-sk', destPath]);
        const match = out.trim().split(/\s/)[0];
        if (match && /^\d+$/.test(match)) dataBytes += parseInt(match, 10) * 1024;
      } catch {
        // skip inaccessible path, keep aggregating others
      }
    }
  }

  const totalBytes = dataBytes + writableBytes;
  return {
    state,
    data_bytes: dataBytes,
    writable_bytes: writableBytes,
    total_bytes: totalBytes,
    total_mb: Math.round(totalBytes / 1024 / 1024),
  };
}

async function getContainerStats(idOrName) {
  const containerInspect = await getContainer(idOrName);
  if (!containerInspect) return null;
  const state = containerInspect.State?.Status || 'unknown';
  const out = { state };

  if (state !== 'running') return out;

  const c = docker.getContainer(containerInspect.Id);
  return new Promise((resolve) => {
    c.stats({ stream: true }, (err, stream) => {
      if (err) {
        resolve(out);
        return;
      }
      readStatsFrames(stream, 3)
        .then((frames) => {
          const first = frames[0];
          const last = frames[frames.length - 1];
          const mem = first.memory_stats || {};
          const usage = mem.usage || 0;
          const stats = mem.stats || {};
          const cache = stats.inactive_file ?? stats.cache ?? 0;
          const effectiveUsage = cache > 0 && cache < usage ? usage - cache : usage;
          out.memory_usage_mb = Math.round(effectiveUsage / 1024 / 1024);
          out.memory_limit_mb = Math.round((mem.limit || 0) / 1024 / 1024);
          let cpu = null;
          if (last.precpu_stats?.system_cpu_usage != null && last.cpu_stats?.system_cpu_usage != null) {
            cpu = computeCpuPercentFromPrecpu(last);
          } else if (frames.length >= 2) {
            cpu = computeCpuPercent(frames[frames.length - 2], last);
          }
          out.cpu_percent = cpu != null ? Math.round(cpu * 10) / 10 : null;
          resolve(out);
        })
        .catch(() => resolve(out));
    });
  });
}

async function restartContainer(idOrName, hooks = {}) {
  const onPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : () => {};
  onPhase('restarting_container', 'Restarting container');
  const container = await getContainer(idOrName);
  if (!container) return { ok: false };
  const c = docker.getContainer(container.Id);
  await c.restart({ t: 10 });
  onPhase('succeeded', 'Container restarted');
  return { ok: true };
}

async function stopContainer(idOrName, hooks = {}) {
  const onPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : () => {};
  onPhase('stopping_container', 'Stopping container');
  const container = await getContainer(idOrName);
  if (!container) return { ok: false };
  const c = docker.getContainer(container.Id);
  try {
    await c.stop({ t: 10 });
  } catch (e) {
    if (e.statusCode !== 304) throw e;
  }
  onPhase('succeeded', 'Container stopped');
  return { ok: true };
}

async function startContainer(idOrName, hooks = {}) {
  const onPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : () => {};
  onPhase('starting_container', 'Starting container');
  const container = await getContainer(idOrName);
  if (!container) return { ok: false };
  const c = docker.getContainer(container.Id);
  await c.start();
  onPhase('succeeded', 'Container started');
  return { ok: true };
}

function demuxDockerLogBuffer(buffer) {
  if (!buffer || !buffer.length) return '';
  if (buffer[0] !== 0x01 && buffer[0] !== 0x02) {
    return buffer.toString('utf8');
  }
  let out = '';
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const lineLen = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (lineLen <= 0 || offset + lineLen > buffer.length) break;
    out += buffer.slice(offset, offset + lineLen).toString('utf8');
    offset += lineLen;
  }
  return out;
}

function containerLogsPromise(container, opts) {
  return new Promise((resolve, reject) => {
    container.logs(opts, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** Last stdout/stderr lines (docker logs). */
async function getContainerLogs(idOrName, { tail = 500, timestamps = false } = {}) {
  const containerInspect = await getContainer(idOrName);
  if (!containerInspect) return null;
  const tailN = Math.min(Math.max(parseInt(String(tail), 10) || 500, 1), 5000);
  const c = docker.getContainer(containerInspect.Id);
  const raw = await containerLogsPromise(c, {
    stdout: true,
    stderr: true,
    tail: tailN,
    timestamps: Boolean(timestamps),
    follow: false,
  });
  const logs = demuxDockerLogBuffer(Buffer.isBuffer(raw) ? raw : Buffer.from(raw || ''));
  return {
    id: containerInspect.Id,
    name: (containerInspect.Name || '').replace(/^\//, ''),
    state: containerInspect.State?.Status || 'unknown',
    tail: tailN,
    logs,
  };
}

async function deleteManagedContainer(idOrName, removeData = false, hooks = {}) {
  const onPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : () => {};
  const { getTemplateById } = require('./templates');
  const {
    runProvisionBlock,
    resolveDeleteTemplateId,
    resolveDeployIdentifier,
  } = require('./provisionRunner');
  const container = await getContainer(idOrName);
  const deployId = resolveDeployIdentifier(idOrName, container);
  let deprovisionWarning = null;

  if (removeData) {
    const templateId = resolveDeleteTemplateId(hooks.templateId, container);
    if (templateId) {
      const template = getTemplateById(templateId);
      if (!template) {
        const err = new Error('Template not found');
        err.statusCode = 404;
        throw err;
      }
      if (template.deprovision) {
        onPhase('deprovisioning', 'Running deprovision');
        try {
          await runProvisionBlock(
            template.deprovision,
            { containerName: deployId, params: {}, deployBasePath: DEPLOY_BASE_PATH },
            { onPhase, failPhase: 'deprovision_failed' },
          );
        } catch (err) {
          deprovisionWarning = err?.message || 'deprovision_failed';
          onPhase('deprovision_warning', deprovisionWarning);
        }
      }
    }
  }

  const result = await stopAndRemoveContainer(idOrName, removeData, { onPhase, deployId });
  if (deprovisionWarning) result.deprovisionWarning = deprovisionWarning;
  return result;
}

module.exports = {
  createAndStart,
  listContainers,
  getContainer,
  getContainerCount,
  getContainerStats,
  getContainerDiskUsage,
  getContainerLogs,
  removeDeployDataDir,
  stopAndRemoveContainer,
  deleteManagedContainer,
  restartContainer,
  stopContainer,
  startContainer,
  validateVolumePaths: validateVolumePathsForSpec,
  CONTAINER_LIMIT,
  DEPLOY_BASE_PATH: DEPLOY_BASE_PATH_RESOLVED,
};
