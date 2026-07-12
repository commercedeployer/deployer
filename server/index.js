/**
 * Container deploy admin: login, JSON templates, Docker API.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');

if (process.env.NODE_ENV === 'production') {
  const secret = process.env.DEPLOYER_SECRET;
  if (!secret || secret === 'change-me-in-production') {
    console.error('Fatal: DEPLOYER_SECRET must be set in production. Set DEPLOYER_SECRET in .env or environment.');
    process.exit(1);
  }
}
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const pkg = require('../package.json');
let openapi = fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf8');
if (openapi.charCodeAt(0) === 0xFEFF) openapi = openapi.slice(1);
openapi = JSON.parse(openapi);
const { getDeployerSecret, verifyPassword, requireAuth, requireUiSession, requireDeployAuth, isApiKeyValid, getDeployAuthMode } = require('./auth');
const { loadTemplates, ensureDefaultTemplates, syncTemplatesFromDefault, getTemplateById, saveTemplate, deleteTemplate, applyParams, fillDefaults, normalizeTemplateShape } = require('./templates');
const { listContainers, getContainer, getContainerStats, getContainerDiskUsage, getContainerLogs, deleteManagedContainer, restartContainer, stopContainer, startContainer, CONTAINER_LIMIT } = require('./docker');
const {
  parseListQuery,
  paginateList,
  CONTAINERS_LIST_DEFAULT_LIMIT,
  CONTAINERS_LIST_MAX_LIMIT,
} = require('./listPagination');
const { enqueueOperation, getOperation, publicOperation } = require('./operations');
const { getCapacitySnapshot, probeDocker } = require('./capacity');
const {
  createImportSession,
  consumeImportToken,
  getVolumeManifest,
  unpackArchive,
  transferVolumeToTarget,
  syncVolumeToPeer,
} = require('./volumeTransfer');
const { resolveSlotKey, normalizeDockerContainerName, INSTANCE_LABEL, TEMPLATE_LABEL, templateIdFromLabels } = require('./deployIdentity');
const { REGISTERED: GEN_TOKENS } = require('./genTokens');
const { createGenCache } = require('./genTokens');
const { executeDeploy, deployContext, findTemplate } = require('./deployService');
const { listVaultKeys, setVaultSecret, deleteVaultSecret } = require('./secretsStore');
const { createMcpServer } = require('./mcp/server');
const { createMcpKeyRoutes } = require('./routes/mcpKeyRoutes');

const SYNC_LEGACY = String(process.env.DEPLOYER_SYNC_LEGACY || '0').trim() === '1';

function acceptOperation(res, op) {
  const payload = { ok: true, operation: publicOperation(op) };
  res.set('Location', `/api/operations/${op.id}`);
  res.set('Retry-After', '2');
  return res.status(202).json(payload);
}

function apiKeyFromReq(req) {
  return String(req.headers['x-api-key'] || '').trim() || 'anonymous';
}

function sendOpError(res, err) {
  const status = err?.statusCode || 500;
  const body = { ok: false, error: err?.message || 'operation_failed' };
  if (err?.retryAfterSec != null) {
    body.retryAfterSec = err.retryAfterSec;
    res.set('Retry-After', String(err.retryAfterSec));
  }
  if (err?.existingOperationId) body.existingOperationId = err.existingOperationId;
  return res.status(status).json(body);
}

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '').trim();

// Behind reverse proxy (Traefik): required for express-rate-limit X-Forwarded-For
app.set('trust proxy', 1);

if (CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
} else {
  // Secure default: no cross-origin browser API calls.
  app.use(cors({ origin: false }));
}
const isDev = process.env.NODE_ENV !== 'production';
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
};
if (isDev) {
  // HTTP dev on LAN IP: without this the browser upgrades assets to https:// and UI breaks.
  cspDirectives.upgradeInsecureRequests = null;
}
app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  strictTransportSecurity: isDev ? false : undefined,
}));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(cookieSession({
  name: 's',
  secret: getDeployerSecret(),
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // strict: admin cookie not sent on cross-site navigation — CSRF mitigation for mutations.
  sameSite: 'strict',
}));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/docs', express.static(path.join(__dirname, '..', 'docs')));

app.use('/mcp', createMcpServer());
app.use(createMcpKeyRoutes());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 1000 : 10,
  message: { error: 'Too many attempts' },
});
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    if (!verifyPassword(username, password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  req.session.user = username;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  const apiKey = req.headers['x-api-key'];
  if (apiKey && isApiKeyValid(apiKey)) return res.json({ user: 'api-key' });
  res.status(401).json({ error: 'Not authenticated' });
});

app.get('/api/health', async (req, res) => {
  const docker = await probeDocker();
  res.json({ ok: true, docker });
});

app.get('/api/capacity', requireDeployAuth, async (req, res) => {
  try {
    const snap = await getCapacitySnapshot();
    res.json(snap);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'capacity_failed' });
  }
});

app.get('/api/version', (req, res) => {
  res.json({ version: pkg.version, authMode: getDeployAuthMode() });
});

app.get('/api/substitution-tokens', requireAuth, (req, res) => {
  res.json({
    gen: GEN_TOKENS,
    resolutionOrder: [
      'deploy params (form + containerName)',
      'provision step outputs',
      'vault (secrets.json)',
      'Deployer container env',
    ],
  });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Deployer API' }));
app.get('/api/openapi.json', (req, res) => res.json(openapi));

const deployLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: apiKeyFromReq,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.set('Retry-After', '60');
    res.status(429).json({ ok: false, error: 'rate_limit_exceeded', retryAfterSec: 60 });
  },
});
const operationPollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: apiKeyFromReq,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.set('Retry-After', '60');
    res.status(429).json({ ok: false, error: 'rate_limit_exceeded', retryAfterSec: 60 });
  },
});
const templatesLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many requests' } });
const vaultLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many vault requests' } });
const diskLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many disk usage requests' } });
const logsLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many log requests' } });

app.get('/api/vault', requireUiSession, (req, res) => {
  try {
    res.json({ ok: true, keys: listVaultKeys() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'vault_list_failed' });
  }
});

app.put('/api/vault/:key', requireUiSession, vaultLimiter, (req, res) => {
  try {
    const result = setVaultSecret(req.params.key, req.body?.value);
    res.json({ ok: true, ...result });
  } catch (err) {
    const code = err.code === 'vault_invalid_key' ? 400 : 500;
    res.status(code).json({ ok: false, error: err.message || 'vault_set_failed' });
  }
});

app.delete('/api/vault/:key', requireUiSession, vaultLimiter, (req, res) => {
  try {
    const result = deleteVaultSecret(req.params.key);
    res.json({ ok: true, ...result });
  } catch (err) {
    const code = err.code === 'vault_invalid_key' ? 400 : 500;
    res.status(code).json({ ok: false, error: err.message || 'vault_delete_failed' });
  }
});

app.get('/api/templates', requireAuth, (req, res) => {
  const list = loadTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || '',
    image: t.image,
    fields: t.fields || [],
  }));
  res.json(list);
});

app.get('/api/templates/:id', requireAuth, (req, res) => {
  const template = getTemplateById(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json(template);
});

app.post('/api/templates', requireAuth, templatesLimiter, (req, res) => {
  const template = req.body;
  if (!template || !template.id) {
    return res.status(400).json({ error: 'Template id required' });
  }
  try {
    const saved = saveTemplate(template);
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Save failed' });
  }
});

app.delete('/api/templates/:id', requireAuth, (req, res) => {
  try {
    const deleted = deleteTemplate(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Delete failed' });
  }
});

app.post('/api/deploy', requireDeployAuth, deployLimiter, async (req, res) => {
  const body = req.body || {};
  const templateId = body.templateId;
  if (typeof templateId !== 'string' || !templateId.trim()) {
    return res.status(400).json({ error: 'templateId required' });
  }
  if (typeof body.params !== 'object' || body.params === null) {
    return res.status(400).json({ error: 'params required' });
  }
  let containerName;
  try {
    containerName = normalizeDockerContainerName(body.containerName);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'containerName required' });
  }
  const template = findTemplate(templateId);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  const paramsCopy = body.params && typeof body.params === 'object' ? { ...body.params } : {};
  const ctx = deployContext();
  const genCache = createGenCache();
  const ctxWithName = { ...ctx, containerName, genCache };
  if (!template.provision) {
    try {
      const normalized = normalizeTemplateShape(template);
      const filled = fillDefaults(normalized, paramsCopy, ctxWithName);
      applyParams(template, filled, ctxWithName);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid params' });
    }
  }
  const slotKey = resolveSlotKey(containerName);
  if (SYNC_LEGACY) {
    try {
      const result = await executeDeploy({
        template,
        containerName,
        params: paramsCopy,
        onPhase: () => {},
      });
      return res.json({ ok: true, container: result.container, params: result.params });
    } catch (err) {
      console.error('Deploy error:', err);
      const status = err?.phase === 'provision_failed' ? 500 : 500;
      return res.status(status).json({ error: err.message || 'Deploy failed' });
    }
  }
  try {
    const op = enqueueOperation({
      kind: 'deploy',
      slotKey,
      execute: async ({ onPhase }) =>
        executeDeploy({
          template,
          containerName,
          params: paramsCopy,
          onPhase,
        }),
    });
    return acceptOperation(res, op);
  } catch (err) {
    if (err?.statusCode) return sendOpError(res, err);
    console.error('Deploy enqueue error:', err);
    return res.status(500).json({ error: err.message || 'Deploy failed' });
  }
});

app.get('/api/operations/:id', requireDeployAuth, operationPollLimiter, (req, res) => {
  const op = getOperation(req.params.id);
  if (!op) return res.status(404).json({ ok: false, error: 'operation_not_found' });
  res.set('Retry-After', '2');
  return res.status(200).json({ ok: true, operation: publicOperation(op) });
});

app.get('/api/containers', requireAuth, async (req, res) => {
  try {
    const all = req.query.all === 'true' || req.query.all === '1';
    const q = String(req.query.q || '').trim().toLowerCase();
    const { limit, offset } = parseListQuery(req.query, {
      defaultLimit: CONTAINERS_LIST_DEFAULT_LIMIT,
      maxLimit: CONTAINERS_LIST_MAX_LIMIT,
    });
    let list = await listContainers(all);
    if (q) {
      list = list.filter((c) => {
        const name = String(c.name || '').toLowerCase();
        const image = String(c.image || '').toLowerCase();
        const deployName = String(c.deployName || '').toLowerCase();
        return name.includes(q) || image.includes(q) || deployName.includes(q);
      });
    }
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    const page = paginateList(list, {
      limit,
      offset,
      defaultLimit: CONTAINERS_LIST_DEFAULT_LIMIT,
      maxLimit: CONTAINERS_LIST_MAX_LIMIT,
    });
    res.json({
      containers: page.items,
      total: page.total,
      offset: page.offset,
      limit: page.limit,
      page: page.page,
      total_pages: page.total_pages,
      has_more: page.has_more,
      container_limit: CONTAINER_LIMIT,
    });
  } catch (err) {
    console.error('List containers:', err);
    res.status(500).json({ error: err.message || 'Failed to list containers' });
  }
});

app.get('/api/containers/:id', requireAuth, async (req, res) => {
  try {
    const container = await getContainer(req.params.id);
    if (!container) return res.status(404).json({ error: 'Container not found' });
    const labels = container.Config?.Labels || {};
    const payload = {
      id: container.Id,
      name: container.Name?.replace(/^\//, ''),
      state: container.State?.Status,
      image: container.Config?.Image,
      deployName: labels[INSTANCE_LABEL] || '',
      templateId: templateIdFromLabels(labels),
      mounts: (container.Mounts || []).map((m) => ({ source: m.Source || m.Name, destination: m.Destination })),
    };
    if (req.query.stats === '1') {
      const stats = await getContainerStats(req.params.id);
      if (stats) payload.stats = stats;
    }
    if (req.query.inspect === '1') {
      payload.inspect = container;
    }
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get container' });
  }
});

app.get('/api/containers/:id/stats', requireAuth, async (req, res) => {
  try {
    const stats = await getContainerStats(req.params.id);
    if (!stats) return res.status(404).json({ error: 'Container not found' });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get stats' });
  }
});

app.get('/api/containers/:id/disk', requireAuth, diskLimiter, async (req, res) => {
  try {
    const disk = await getContainerDiskUsage(req.params.id);
    if (!disk) return res.status(404).json({ error: 'Container not found' });
    res.json(disk);
  } catch (err) {
    console.error('Container disk:', err);
    res.status(500).json({ error: err.message || 'Failed to get disk usage' });
  }
});

app.get('/api/containers/:id/logs', requireAuth, logsLimiter, async (req, res) => {
  try {
    const tail = req.query.tail;
    const timestamps = req.query.timestamps === '1' || req.query.timestamps === 'true';
    const payload = await getContainerLogs(req.params.id, { tail, timestamps });
    if (!payload) return res.status(404).json({ error: 'Container not found' });
    res.json(payload);
  } catch (err) {
    console.error('Container logs:', err);
    res.status(500).json({ error: err.message || 'Failed to get logs' });
  }
});

app.post('/api/containers/:id/restart', requireAuth, deployLimiter, async (req, res) => {
  const slotKey = String(req.params.id || '').trim();
  try {
    if (SYNC_LEGACY) {
      const result = await restartContainer(req.params.id);
      if (!result.ok) return res.status(404).json({ error: 'Container not found' });
      return res.json({ ok: true });
    }
    const op = enqueueOperation({
      kind: 'restart',
      slotKey,
      execute: async ({ onPhase }) => {
        const result = await restartContainer(req.params.id, { onPhase });
        if (!result.ok) throw new Error('Container not found');
        return result;
      },
    });
    return acceptOperation(res, op);
  } catch (err) {
    if (err?.statusCode) return sendOpError(res, err);
    console.error('Restart container:', err);
    res.status(500).json({ error: err.message || 'Failed to restart' });
  }
});

app.post('/api/containers/:id/stop', requireAuth, deployLimiter, async (req, res) => {
  const slotKey = String(req.params.id || '').trim();
  try {
    if (SYNC_LEGACY) {
      const result = await stopContainer(req.params.id);
      if (!result.ok) return res.status(404).json({ error: 'Container not found' });
      return res.json({ ok: true });
    }
    const op = enqueueOperation({
      kind: 'stop',
      slotKey,
      execute: async ({ onPhase }) => {
        const result = await stopContainer(req.params.id, { onPhase });
        if (!result.ok) throw new Error('Container not found');
        return result;
      },
    });
    return acceptOperation(res, op);
  } catch (err) {
    if (err?.statusCode) return sendOpError(res, err);
    console.error('Stop container:', err);
    res.status(500).json({ error: err.message || 'Failed to stop' });
  }
});

app.post('/api/containers/:id/start', requireAuth, deployLimiter, async (req, res) => {
  const slotKey = String(req.params.id || '').trim();
  try {
    if (SYNC_LEGACY) {
      const result = await startContainer(req.params.id);
      if (!result.ok) return res.status(404).json({ error: 'Container not found' });
      return res.json({ ok: true });
    }
    const op = enqueueOperation({
      kind: 'start',
      slotKey,
      execute: async ({ onPhase }) => {
        const result = await startContainer(req.params.id, { onPhase });
        if (!result.ok) throw new Error('Container not found');
        return result;
      },
    });
    return acceptOperation(res, op);
  } catch (err) {
    if (err?.statusCode) return sendOpError(res, err);
    console.error('Start container:', err);
    res.status(500).json({ error: err.message || 'Failed to start' });
  }
});

app.delete('/api/containers/:id', requireAuth, deployLimiter, async (req, res) => {
  const removeData = req.query.removeData === 'true';
  const templateId = typeof req.query.templateId === 'string' ? req.query.templateId.trim() : '';
  const slotKey = String(req.params.id || '').trim();
  if (removeData && templateId && !getTemplateById(templateId)) {
    return res.status(404).json({ error: 'Template not found' });
  }
  try {
    if (SYNC_LEGACY) {
      const result = await deleteManagedContainer(req.params.id, removeData, { templateId });
      return res.json({
        ok: true,
        removed: result.removed,
        alreadyGone: result.alreadyGone,
        dataRemoved: result.dataRemoved || [],
        deprovisionWarning: result.deprovisionWarning || null,
      });
    }
    const op = enqueueOperation({
      kind: 'delete',
      slotKey,
      execute: async ({ onPhase }) =>
        deleteManagedContainer(req.params.id, removeData, { onPhase, templateId }),
    });
    return acceptOperation(res, op);
  } catch (err) {
    if (err?.statusCode) return sendOpError(res, err);
    console.error('Delete container:', err);
    res.status(500).json({ error: err.message || 'Failed to delete container' });
  }
});

app.get('/api/volumes/:containerName/manifest', requireDeployAuth, (req, res) => {
  try {
    const detail = req.query.detail === '1' || req.query.detail === 'true';
    const manifest = getVolumeManifest(req.params.containerName, { detail });
    res.json({ ok: true, manifest });
  } catch (err) {
    res.status(400).json({ error: err.message || 'manifest_failed' });
  }
});

app.post('/api/volumes/:containerName/import-session', requireDeployAuth, (req, res) => {
  try {
    const session = createImportSession(req.params.containerName);
    res.json({ ok: true, ...session });
  } catch (err) {
    res.status(400).json({ error: err.message || 'import_session_failed' });
  }
});

app.post('/api/volumes/:containerName/import-stream', requireDeployAuth, async (req, res) => {
  const token = String(req.query.token || '').trim();
  const name = req.params.containerName;
  const { instanceDataDir, peekImportToken, consumeImportToken, runTarUnpackStream } = require('./volumeTransfer');
  if (!peekImportToken(token, name)) {
    return res.status(403).json({ error: 'invalid_import_token' });
  }
  try {
    await runTarUnpackStream(req, instanceDataDir(name));
    if (!consumeImportToken(token, name)) {
      return res.status(403).json({ error: 'invalid_import_token' });
    }
    res.json({ ok: true, containerName: normalizeDockerContainerName(name) });
  } catch (err) {
    console.error('import-stream:', err);
    res.status(500).json({ error: err.message || 'import_failed' });
  }
});

app.post('/api/volumes/:containerName/transfer', requireDeployAuth, deployLimiter, async (req, res) => {
  const body = req.body || {};
  const containerName = body.containerName || req.params.containerName;
  try {
    normalizeDockerContainerName(containerName);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'containerName required' });
  }
  const slotKey = `vol:${String(containerName).trim()}`;
  try {
    const op = enqueueOperation({
      kind: 'transfer',
      slotKey,
      execute: async ({ onPhase }) =>
        transferVolumeToTarget({
          containerName,
          targetBaseUrl: body.targetBaseUrl,
          importToken: body.importToken,
          onPhase,
        }),
    });
    return acceptOperation(res, op);
  } catch (err) {
    if (err?.statusCode) return sendOpError(res, err);
    res.status(500).json({ error: err.message || 'transfer_failed' });
  }
});

app.post('/api/volumes/:containerName/sync', requireDeployAuth, deployLimiter, async (req, res) => {
  const body = req.body || {};
  const containerName = body.containerName || req.params.containerName;
  try {
    normalizeDockerContainerName(containerName);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'containerName required' });
  }
  const mode = String(body.mode || 'quiesced').trim() === 'hot' ? 'hot' : 'quiesced';
  const slotKey = `vol:${String(containerName).trim()}`;
  try {
    const op = enqueueOperation({
      kind: 'sync',
      slotKey,
      execute: async ({ onPhase }) =>
        syncVolumeToPeer({
          containerName,
          targetBaseUrl: body.targetBaseUrl,
          importToken: body.importToken,
          mode,
          onPhase,
        }),
    });
    return acceptOperation(res, op);
  } catch (err) {
    if (err?.statusCode) return sendOpError(res, err);
    res.status(500).json({ error: err.message || 'sync_failed' });
  }
});

app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/index.html');
  }
  res.redirect('/login.html');
});

if (require.main === module) {
  let result = ensureDefaultTemplates();
  if (result.copied > 0) {
    console.log('Default templates copied:', result.copied);
  }
  if (result.failed && result.failed.length > 0) {
    console.warn('Default templates copy failed (templates dir not writable?):', result.failed.join('; '));
    console.warn('On host run: chown 1000:1000 <path-to-templates> (e.g. /opt/deployer/templates)');
  }
  const loaded = loadTemplates();
  if (loaded.length === 0) {
    try {
      result = syncTemplatesFromDefault();
      console.log('Templates restored from bundled templates:', result.copied.length);
    } catch (err) {
      console.warn('Could not restore templates from bundled templates:', err.message);
    }
  } else {
    console.log('Templates loaded:', loaded.length);
  }
  app.listen(PORT, () => {
    console.log('Deployer listening on port', PORT);
  });
}

module.exports = app;
