/**
 * Load templates from JSON files. Substitute {{KEY}} placeholders from params.
 * If work dir is empty (e.g. -v host:/app/templates mount), seed from bundled templates inside the image.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createGenCache, isGenToken, resolveGenToken } = require('./genTokens');
const { normalizeRestartPolicy, normalizeRestartMaxRetries } = require('./restartPolicy');
const { normalizeVolumeEntry } = require('./volumes');
const { normalizeNetworkEntry } = require('./networks');
const { resolveVaultValue, VAULT_KEY_RE } = require('./secretsStore');

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.join(__dirname, '..', 'templates');
// Bundled templates live inside the image. During migration we keep backward compatibility:
// - `TEMPLATES_BUNDLED_DIR` (new)
// - `TEMPLATES_DEFAULT_DIR` (old env used in tests)
const TEMPLATES_BUNDLED_DIR = process.env.TEMPLATES_BUNDLED_DIR
  || process.env.TEMPLATES_DEFAULT_DIR
  || path.join(__dirname, '..', 'templates-bundled');

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const TEST_TEMPLATE_ID = /^(api-test-tpl-|test-template-id-)/;

function listTemplateJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

/** Copy bundled defaults into work directory (full restore). */
function syncTemplatesFromDefault(targetDir = TEMPLATES_DIR, sourceDir = TEMPLATES_BUNDLED_DIR) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`templates bundled missing: ${sourceDir}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const copied = [];
  for (const file of listTemplateJsonFiles(sourceDir)) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
    copied.push(file);
  }
  const removed = [];
  for (const file of listTemplateJsonFiles(targetDir)) {
    const id = file.replace(/\.json$/, '');
    if (!copied.includes(file) && TEST_TEMPLATE_ID.test(id)) {
      fs.rmSync(path.join(targetDir, file), { force: true });
      removed.push(file);
    }
  }
  return { copied, removed, targetDir, sourceDir };
}

function resolveDeployerTemplatesDir() {
  return process.env.DEPLOYER_TEMPLATES_RESTORE_DIR
    || path.join(__dirname, '..', 'templates');
}

/** Restore dev catalog from bundled templates (same as empty dir on startup). */
function restoreDeployerTemplatesZeroState(targetDir = resolveDeployerTemplatesDir()) {
  return syncTemplatesFromDefault(targetDir);
}

/** Returns { copied, failed[] } for startup logging. */
function ensureDefaultTemplates() {
  const list = loadTemplatesNoInit();
  if (list.length > 0) return { copied: 0, failed: [] };
  if (!fs.existsSync(TEMPLATES_BUNDLED_DIR)) return { copied: 0, failed: [] };
  const defaultFiles = fs.readdirSync(TEMPLATES_BUNDLED_DIR).filter((f) => f.endsWith('.json'));
  if (defaultFiles.length === 0) return { copied: 0, failed: [] };
  if (!fs.existsSync(TEMPLATES_DIR)) {
    try {
      fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
    } catch (e) {
      console.warn('Templates: cannot create dir', TEMPLATES_DIR, e.message);
      return { copied: 0, failed: [e.message] };
    }
  }
  let copied = 0;
  const failed = [];
  for (const f of defaultFiles) {
    try {
      const src = path.join(TEMPLATES_BUNDLED_DIR, f);
      const dest = path.join(TEMPLATES_DIR, f);
      fs.copyFileSync(src, dest);
      copied++;
    } catch (e) {
      failed.push(`${f}: ${e.code || e.message}`);
    }
  }
  return { copied, failed };
}

function loadTemplatesNoInit() {
  const dir = TEMPLATES_DIR;
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const t = JSON.parse(raw);
      if (t.id && t.name) out.push(t);
    } catch (e) {
      console.warn('Skip template', file, e.message);
    }
  }
  return out;
}

function loadTemplates() {
  ensureDefaultTemplates();
  return loadTemplatesNoInit();
}

function getTemplateById(id) {
  if (!id || !SAFE_ID.test(id)) return null;
  const file = path.join(TEMPLATES_DIR, id + '.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeProvisionBlocksFromExisting(incoming, existing) {
  if (!existing || typeof incoming !== 'object') return incoming;
  const out = { ...incoming };
  for (const key of ['provision', 'deprovision', 'postStart']) {
    if (out[key] == null && existing[key] != null) {
      out[key] = existing[key];
    }
  }
  for (const key of ['provision', 'deprovision']) {
    const next = out[key];
    const prev = existing[key];
    if (
      prev?.env
      && typeof prev.env === 'object'
      && !Array.isArray(prev.env)
      && next
      && typeof next === 'object'
      && !Array.isArray(next)
      && !next.env
    ) {
      out[key] = { ...next, env: { ...prev.env } };
    }
  }
  return out;
}

function saveTemplate(template) {
  const id = template && template.id;
  if (!id || !SAFE_ID.test(id)) {
    throw new Error('Invalid template id (only letters, numbers, underscore, hyphen)');
  }
  const existing = getTemplateById(id);
  const normalized = mergeProvisionBlocksFromExisting(normalizeTemplateShape(template), existing);
  const dir = TEMPLATES_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.json');
  const out = {
    id: normalized.id,
    name: normalized.name || normalized.id,
    description: normalized.description || '',
    image: normalized.image || '',
    pullPolicy: normalized.pullPolicy || '',
    restartPolicy: normalized.restartPolicy || '',
    restartMaxRetries: normalized.restartMaxRetries ?? '',
    platform: normalized.platform || '',
    waitHealthy: Boolean(normalized.waitHealthy),
    waitHealthyTimeoutSec: normalized.waitHealthyTimeoutSec ?? '',
    fields: Array.isArray(normalized.fields)
      ? normalized.fields.map((f) => ({
        key: f.key,
        label: f.label || '',
        default: f.default != null ? String(f.default) : '',
      })).filter((f) => f.key)
      : [],
    env: Array.isArray(normalized.env) ? normalized.env : [],
    volumes: Array.isArray(normalized.volumes) ? normalized.volumes : [],
    labels: Array.isArray(normalized.labels) ? normalized.labels : [],
    networks: Array.isArray(normalized.networks) ? normalized.networks : [],
    ports: Array.isArray(normalized.ports) ? normalized.ports : [],
    user: normalized.user || '',
    entrypoint: Array.isArray(normalized.entrypoint) ? normalized.entrypoint : [],
    command: Array.isArray(normalized.command) ? normalized.command : [],
    limits: normalized.limits && typeof normalized.limits === 'object' ? normalized.limits : {},
    dockerParams: Array.isArray(normalized.dockerParams) ? normalized.dockerParams : [],
  };
  if (normalized.provision != null) out.provision = normalized.provision;
  if (normalized.deprovision != null) out.deprovision = normalized.deprovision;
  if (normalized.postStart != null) out.postStart = normalized.postStart;
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

function deleteTemplate(id) {
  if (!id || !SAFE_ID.test(id)) {
    throw new Error('Invalid template id');
  }
  const file = path.join(TEMPLATES_DIR, id + '.json');
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveDeployerEnv(key) {
  const trimmed = String(key).trim();
  if (!VAULT_KEY_RE.test(trimmed)) return null;
  const fromEnv = process.env[trimmed];
  if (fromEnv == null || String(fromEnv).trim() === '') return null;
  return String(fromEnv);
}

function substitute(str, params, context = {}) {
  if (typeof str !== 'string') return str;
  const genCache = context.genCache;
  const lookup = (key) => {
    const trimmed = String(key).trim();
    if (genCache && isGenToken(trimmed)) {
      const generated = resolveGenToken(trimmed, genCache);
      if (generated != null) return generated;
    }
    if (Object.prototype.hasOwnProperty.call(params, trimmed)) {
      return params[trimmed] != null ? String(params[trimmed]) : '';
    }
    if (Object.prototype.hasOwnProperty.call(context, trimmed)) {
      return context[trimmed] != null ? String(context[trimmed]) : '';
    }
    const vaultVal = resolveVaultValue(trimmed);
    if (vaultVal !== null) return vaultVal;
    const envVal = resolveDeployerEnv(trimmed);
    if (envVal !== null) return envVal;
    return null;
  };
  const resolveToken = (rawKey) => {
    const trimmed = String(rawKey).trim();
    if (trimmed.startsWith('BCRYPT:')) {
      const paramKey = trimmed.slice('BCRYPT:'.length).trim();
      const plain = lookup(paramKey);
      if (plain === null || plain === '') return null;
      return bcrypt.hashSync(plain, 10);
    }
    return lookup(trimmed);
  };
  let out = str;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const value = resolveToken(key);
      return value === null ? `{{${key}}}` : value;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function fillDefaults(template, params, context = {}) {
  const out = { ...params };
  (template.fields || []).forEach((f) => {
    if (out[f.key] != null && String(out[f.key]).trim() !== '') return;
    if (f.default != null && f.default !== '') {
      out[f.key] = substitute(f.default, out, context);
    }
  });
  return out;
}

function normalizeTemplateShape(template) {
  const t = template && typeof template === 'object' ? template : {};
  const out = { ...t };
  if (!Array.isArray(out.networks)) {
    out.networks = [];
    const legacyNet = String(out.network || '').trim();
    if (legacyNet) out.networks.push(legacyNet);
  }
  if (!Array.isArray(out.ports)) {
    out.ports = [];
    const legacyHost = out.port;
    const legacyPublish = out.publishPort === true;
    if (legacyPublish && legacyHost != null && legacyHost !== '') {
      out.ports.push({
        containerPort: out.containerPort != null ? out.containerPort : 80,
        hostPort: legacyHost,
        protocol: 'tcp',
      });
    }
  }
  if (!Array.isArray(out.entrypoint)) out.entrypoint = [];
  if (!Array.isArray(out.command)) out.command = [];
  if (!out.limits || typeof out.limits !== 'object') out.limits = {};
  if (!Array.isArray(out.dockerParams)) out.dockerParams = [];
  if (out.restartMaxRetries == null) out.restartMaxRetries = '';
  if (out.platform == null) out.platform = '';
  if (out.waitHealthyTimeoutSec == null) out.waitHealthyTimeoutSec = '';
  return out;
}

function resolvePortValue(raw, subs, ctx, label) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const substituted = substitute(String(raw), subs, ctx);
  assertFullySubstituted(substituted, label);
  const n = parseInt(substituted, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveHostPortValue(raw, subs, ctx, label) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number') return String(raw);
  const substituted = substitute(String(raw), subs, ctx);
  assertFullySubstituted(substituted, label);
  return substituted.trim();
}

function normalizeProtocol(raw) {
  const p = String(raw || 'tcp').trim().toLowerCase();
  return p === 'udp' ? 'udp' : 'tcp';
}

function findUnresolvedPlaceholders(str) {
  if (typeof str !== 'string') return [];
  const matches = str.match(/\{\{([^}]+)\}\}/g) || [];
  return matches.map((m) => m.slice(2, -2).trim());
}

function assertFullySubstituted(str, label) {
  const unresolved = findUnresolvedPlaceholders(str);
  for (const key of unresolved) {
    if (isGenToken(key)) {
      throw new Error(`Unknown GEN_* token in ${label}: ${key}`);
    }
    throw new Error(`Missing param: ${key} (${label})`);
  }
}

function resolveVolumes(normalized, subs, ctx) {
  return (normalized.volumes || []).map((v, i) => {
    if (typeof v === 'string') {
      const substituted = substitute(v, subs, ctx);
      assertFullySubstituted(substituted, `volume[${i}]`);
      return normalizeVolumeEntry(substituted);
    }
    const type = String(v?.type || 'bind').trim().toLowerCase() === 'volume' ? 'volume' : 'bind';
    const source = substitute(String(v?.source ?? v?.host ?? ''), subs, ctx);
    const container = substitute(String(v?.container ?? v?.target ?? ''), subs, ctx);
    assertFullySubstituted(source, `volume[${i}] source`);
    assertFullySubstituted(container, `volume[${i}] container`);
    const mode = String(v?.mode || 'rw').trim().toLowerCase() === 'ro' ? 'ro' : 'rw';
    return normalizeVolumeEntry({ type, source, container, mode });
  }).filter(Boolean);
}

function resolveNetworks(normalized, subs, ctx) {
  return (normalized.networks || []).map((n, i) => {
    if (typeof n === 'string') {
      const name = substitute(String(n || '').trim(), subs, ctx);
      assertFullySubstituted(name, `network[${i}]`);
      return normalizeNetworkEntry(name);
    }
    const name = substitute(String(n?.name || '').trim(), subs, ctx);
    assertFullySubstituted(name, `network[${i}] name`);
    let aliases = [];
    if (Array.isArray(n?.aliases)) {
      aliases = n.aliases.map((a, j) => {
        const val = substitute(String(a ?? ''), subs, ctx);
        assertFullySubstituted(val, `network[${i}] alias[${j}]`);
        return val.trim();
      }).filter(Boolean);
    } else if (n?.aliases) {
      const val = substitute(String(n.aliases), subs, ctx);
      assertFullySubstituted(val, `network[${i}] aliases`);
      aliases = val.split(',').map((a) => a.trim()).filter(Boolean);
    }
    const ipv4Address = substitute(String(n?.ipv4Address ?? n?.ipv4 ?? ''), subs, ctx).trim();
    if (ipv4Address) assertFullySubstituted(ipv4Address, `network[${i}] ipv4`);
    return normalizeNetworkEntry({ name, aliases, ipv4Address });
  }).filter(Boolean);
}

function assertSpecResolved(spec) {
  for (const e of spec.env || []) {
    assertFullySubstituted(e.value, `env ${e.name}`);
  }
  for (const v of spec.volumes || []) {
    assertFullySubstituted(v.source, `volume ${v.container}`);
    assertFullySubstituted(v.container, `volume ${v.source}`);
  }
  for (const l of spec.labels || []) {
    assertFullySubstituted(l, 'label');
  }
  for (const net of spec.networks || []) {
    assertFullySubstituted(net.name, 'network');
    for (const alias of net.aliases || []) assertFullySubstituted(alias, `network ${net.name} alias`);
    if (net.ipv4Address) assertFullySubstituted(net.ipv4Address, `network ${net.name} ipv4`);
  }
  for (const p of spec.ports || []) {
    if (p.hostPort) assertFullySubstituted(String(p.hostPort), `port ${p.containerPort}`);
  }
  if (spec.pullPolicy) assertFullySubstituted(spec.pullPolicy, 'pullPolicy');
  if (spec.user) assertFullySubstituted(spec.user, 'user');
  for (let i = 0; i < (spec.entrypoint || []).length; i++) {
    assertFullySubstituted(spec.entrypoint[i], `entrypoint[${i}]`);
  }
  for (let i = 0; i < (spec.command || []).length; i++) {
    assertFullySubstituted(spec.command[i], `command[${i}]`);
  }
  if (spec.limits?.memory) assertFullySubstituted(String(spec.limits.memory), 'limits.memory');
  if (spec.limits?.cpus) assertFullySubstituted(String(spec.limits.cpus), 'limits.cpus');
  if (spec.limits?.pidsLimit) assertFullySubstituted(String(spec.limits.pidsLimit), 'limits.pidsLimit');
  if (spec.limits?.memorySwap) assertFullySubstituted(String(spec.limits.memorySwap), 'limits.memorySwap');
  if (spec.platform) assertFullySubstituted(spec.platform, 'platform');
  if (spec.restartMaxRetries != null && spec.restartMaxRetries !== '') {
    assertFullySubstituted(String(spec.restartMaxRetries), 'restartMaxRetries');
  }
  if (spec.waitHealthyTimeoutSec != null && spec.waitHealthyTimeoutSec !== '') {
    assertFullySubstituted(String(spec.waitHealthyTimeoutSec), 'waitHealthyTimeoutSec');
  }
  for (let i = 0; i < (spec.dockerParams || []).length; i++) {
    const p = spec.dockerParams[i];
    assertFullySubstituted(p.value, `dockerParams[${i}] ${p.key}`);
  }
}

function applyParams(template, params, context = {}) {
  const normalized = normalizeTemplateShape(template);
  const deployBasePath = context.deployBasePath || '';
  const genCache = context.genCache || createGenCache();
  const ctx = {
    ...context,
    genCache,
    ...(deployBasePath ? { DEPLOY_BASE_PATH: deployBasePath } : {}),
  };
  const containerNameRaw = String(context.containerName ?? '').trim();
  if (!containerNameRaw) throw new Error('containerName required');
  const { normalizeDockerContainerName } = require('./deployIdentity');
  const dockerName = normalizeDockerContainerName(containerNameRaw);
  const filled = fillDefaults(normalized, params, ctx);
  const subs = { ...filled, CONTAINER_NAME: dockerName };
  const env = (normalized.env || []).map((e) => ({
    name: typeof e === 'string' ? e : e.name,
    value: substitute(typeof e === 'string' ? '' : (e.value ?? ''), subs, ctx),
  })).filter((e) => e.name);
  const labels = (normalized.labels || []).map((l) => substitute(typeof l === 'string' ? l : (l.name && l.value ? `${l.name}=${l.value}` : ''), subs, ctx)).filter(Boolean);
  const volumes = resolveVolumes(normalized, subs, ctx);
  const name = dockerName;
  const networks = resolveNetworks(normalized, subs, ctx);
  const ports = (normalized.ports || []).map((p, i) => {
    const containerPort = resolvePortValue(p.containerPort, subs, ctx, `port[${i}] containerPort`);
    if (!containerPort) {
      throw new Error(`Invalid containerPort in ports[${i}]`);
    }
    const hostPort = resolveHostPortValue(p.hostPort, subs, ctx, `port[${i}] hostPort`);
    return {
      containerPort,
      hostPort,
      protocol: normalizeProtocol(p.protocol),
    };
  }).filter((p) => p.containerPort);
  const userRaw = substitute(normalized.user || '', subs, ctx).trim();
  const entrypoint = (normalized.entrypoint || [])
    .map((arg, i) => substitute(String(arg ?? ''), subs, ctx).trim())
    .filter(Boolean);
  const command = (normalized.command || [])
    .map((arg, i) => substitute(String(arg ?? ''), subs, ctx).trim())
    .filter(Boolean);
  const limitsRaw = normalized.limits && typeof normalized.limits === 'object' ? normalized.limits : {};
  const limits = {};
  const memoryRaw = substitute(String(limitsRaw.memory || ''), subs, ctx).trim();
  const cpusRaw = substitute(String(limitsRaw.cpus || ''), subs, ctx).trim();
  const pidsRaw = substitute(String(limitsRaw.pidsLimit || ''), subs, ctx).trim();
  const memorySwapRaw = substitute(String(limitsRaw.memorySwap || ''), subs, ctx).trim();
  if (memoryRaw) limits.memory = memoryRaw;
  if (cpusRaw) limits.cpus = cpusRaw;
  if (pidsRaw) limits.pidsLimit = pidsRaw;
  if (memorySwapRaw) limits.memorySwap = memorySwapRaw;
  const platform = substitute(String(normalized.platform || ''), subs, ctx).trim();
  const restartMaxRetriesRaw = substitute(String(normalized.restartMaxRetries ?? ''), subs, ctx).trim();
  const restartMaxRetries = normalizeRestartMaxRetries(restartMaxRetriesRaw);
  const waitHealthy = Boolean(normalized.waitHealthy);
  const waitHealthyTimeoutRaw = substitute(String(normalized.waitHealthyTimeoutSec ?? ''), subs, ctx).trim();
  const waitHealthyTimeoutSec = waitHealthyTimeoutRaw
    ? parseInt(waitHealthyTimeoutRaw, 10)
    : 120;
  const dockerParams = (normalized.dockerParams || [])
    .map((p) => {
      const rawKey = String(p?.key ?? '').trim();
      const value = substitute(String(p?.value ?? ''), subs, ctx).trim();
      if (!rawKey || !value) return null;
      return { key: rawKey, value };
    })
    .filter(Boolean);
  const spec = {
    image: normalized.image,
    pullPolicy: substitute(normalized.pullPolicy || '', subs, ctx) || undefined,
    restartPolicy: normalizeRestartPolicy(substitute(normalized.restartPolicy || '', subs, ctx)) || undefined,
    restartMaxRetries: restartMaxRetries ?? undefined,
    platform: platform || undefined,
    waitHealthy: waitHealthy || undefined,
    waitHealthyTimeoutSec: waitHealthy ? waitHealthyTimeoutSec : undefined,
    name,
    env,
    labels,
    volumes,
    networks,
    ports,
    user: userRaw || undefined,
    entrypoint: entrypoint.length ? entrypoint : undefined,
    command: command.length ? command : undefined,
    limits: Object.keys(limits).length ? limits : undefined,
    dockerParams: dockerParams.length ? dockerParams : undefined,
  };
  assertSpecResolved(spec);
  return { spec, filled };
}

module.exports = {
  loadTemplates,
  ensureDefaultTemplates,
  getTemplateById,
  saveTemplate,
  deleteTemplate,
  applyParams,
  substitute,
  fillDefaults,
  normalizeTemplateShape,
  listTemplateJsonFiles,
  syncTemplatesFromDefault,
  restoreDeployerTemplatesZeroState,
  TEMPLATES_BUNDLED_DIR,
  // Backward compatibility for existing tests/scripts.
  TEMPLATES_DEFAULT_DIR: TEMPLATES_BUNDLED_DIR,
};
