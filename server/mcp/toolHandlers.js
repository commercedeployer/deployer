const pkg = require('../../package.json');
const { REGISTERED: GEN_TOKENS } = require('../genTokens');
const { probeDocker } = require('../capacity');
const { getCapacitySnapshot } = require('../capacity');
const {
  loadTemplates,
  getTemplateById,
  saveTemplate,
  deleteTemplate,
} = require('../templates');
const {
  listContainers,
  getContainer,
  getContainerStats,
  getContainerDiskUsage,
  getContainerLogs,
  deleteManagedContainer,
  restartContainer,
  stopContainer,
  startContainer,
  CONTAINER_LIMIT,
} = require('../docker');
const { parseListQuery, paginateList, CONTAINERS_LIST_DEFAULT_LIMIT, CONTAINERS_LIST_MAX_LIMIT } = require('../listPagination');
const { enqueueOperation, getOperation, publicOperation } = require('../operations');
const { getVolumeManifest, createImportSession, transferVolumeToTarget, syncVolumeToPeer } = require('../volumeTransfer');
const { templateIdFromLabels, INSTANCE_LABEL } = require('../deployIdentity');
const { normalizeDockerContainerName } = require('../deployIdentity');
const { executeDeploy, findTemplate } = require('../deployService');
const { getDeployAuthMode } = require('../auth');
const {
  MCP_KEYS_MAX,
  mcpConfig,
} = require('./mcpKeyService');

const SYNC_LEGACY = String(process.env.DEPLOYER_SYNC_LEGACY || '0').trim() === '1';

function httpError(message, statusCode = 400, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function createDeployerToolHandlers() {
  const config = mcpConfig();

  return {
    async deployer_capabilities_ctx(ctx) {
      return {
        ok: true,
        server: 'deployer-mcp',
        version: pkg.version,
        authMode: getDeployAuthMode(),
        keyId: ctx?.actor?.keyId || null,
        label: ctx?.actor?.label || null,
        access: 'full_api',
        mcpUrl: `${config.publicBaseUrl}/mcp`,
        keyLimit: MCP_KEYS_MAX,
      };
    },

    async deployer_health() {
      const docker = await probeDocker();
      return { ok: true, docker };
    },

    async deployer_version_get() {
      return { version: pkg.version, authMode: getDeployAuthMode() };
    },

    async deployer_capacity_get() {
      return getCapacitySnapshot();
    },

    async deployer_substitution_tokens_get() {
      return {
        gen: GEN_TOKENS,
        context: [{ id: 'DEPLOY_BASE_PATH', description: 'Host data directory on Deployer (not a form field)' }],
      };
    },

    async deployer_templates_list() {
      const list = loadTemplates().map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        image: t.image,
        fields: t.fields || [],
      }));
      return { ok: true, templates: list };
    },

    async deployer_template_get({ id }) {
      const template = getTemplateById(id);
      if (!template) throw httpError('Template not found', 404);
      return { ok: true, template };
    },

    async deployer_template_save({ template }) {
      if (!template || !template.id) throw httpError('Template id required');
      const saved = saveTemplate(template);
      return { ok: true, template: saved };
    },

    async deployer_template_delete({ id }) {
      const deleted = deleteTemplate(id);
      if (!deleted) throw httpError('Template not found', 404);
      return { ok: true };
    },

    async deployer_deploy({ templateId, containerName, params }) {
      const template = findTemplate(templateId);
      if (!template) throw httpError('Template not found', 404);
      let normalizedName;
      try {
        normalizedName = normalizeDockerContainerName(containerName);
      } catch (err) {
        throw httpError(err.message || 'containerName required');
      }
      const paramsCopy = params && typeof params === 'object' ? { ...params } : {};
      if (SYNC_LEGACY) {
        const result = await executeDeploy({
          template,
          containerName: normalizedName,
          params: paramsCopy,
          onPhase: () => {},
        });
        return { ok: true, container: result.container, params: result.params };
      }
      const slotKey = require('../deployIdentity').resolveSlotKey(normalizedName);
      const op = enqueueOperation({
        kind: 'deploy',
        slotKey,
        execute: async ({ onPhase }) =>
          executeDeploy({
            template,
            containerName: normalizedName,
            params: paramsCopy,
            onPhase,
          }),
      });
      return { ok: true, operation: publicOperation(op) };
    },

    async deployer_operation_get({ operationId }) {
      const op = getOperation(operationId);
      if (!op) throw httpError('operation_not_found', 404);
      return { ok: true, operation: publicOperation(op) };
    },

    async deployer_containers_list({ all, q, limit, offset } = {}) {
      const showAll = all === true || all === 'true' || all === 1 || all === '1';
      const query = String(q || '').trim().toLowerCase();
      const parsed = parseListQuery({ limit, offset }, {
        defaultLimit: CONTAINERS_LIST_DEFAULT_LIMIT,
        maxLimit: CONTAINERS_LIST_MAX_LIMIT,
      });
      let list = await listContainers(showAll);
      if (query) {
        list = list.filter((c) => {
          const name = String(c.name || '').toLowerCase();
          const image = String(c.image || '').toLowerCase();
          const deployName = String(c.deployName || '').toLowerCase();
          return name.includes(query) || image.includes(query) || deployName.includes(query);
        });
      }
      list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
      const page = paginateList(list, {
        limit: parsed.limit,
        offset: parsed.offset,
        defaultLimit: CONTAINERS_LIST_DEFAULT_LIMIT,
        maxLimit: CONTAINERS_LIST_MAX_LIMIT,
      });
      return {
        ok: true,
        containers: page.items,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        page: page.page,
        total_pages: page.total_pages,
        has_more: page.has_more,
        container_limit: CONTAINER_LIMIT,
      };
    },

    async deployer_container_get({ id, stats, inspect } = {}) {
      const container = await getContainer(id);
      if (!container) throw httpError('Container not found', 404);
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
      if (stats === true || stats === '1' || stats === 1) {
        const s = await getContainerStats(id);
        if (s) payload.stats = s;
      }
      if (inspect === true || inspect === '1' || inspect === 1) {
        payload.inspect = container;
      }
      return { ok: true, container: payload };
    },

    async deployer_container_stats({ id }) {
      const stats = await getContainerStats(id);
      if (!stats) throw httpError('Container not found', 404);
      return { ok: true, stats };
    },

    async deployer_container_disk({ id }) {
      const disk = await getContainerDiskUsage(id);
      if (!disk) throw httpError('Container not found', 404);
      return { ok: true, disk };
    },

    async deployer_container_logs({ id, tail, timestamps } = {}) {
      const payload = await getContainerLogs(id, {
        tail,
        timestamps: timestamps === true || timestamps === 'true' || timestamps === 1 || timestamps === '1',
      });
      if (!payload) throw httpError('Container not found', 404);
      return { ok: true, ...payload };
    },

    async deployer_container_restart({ id }) {
      const slotKey = String(id || '').trim();
      if (SYNC_LEGACY) {
        const result = await restartContainer(id);
        if (!result.ok) throw httpError('Container not found', 404);
        return { ok: true };
      }
      const op = enqueueOperation({
        kind: 'restart',
        slotKey,
        execute: async ({ onPhase }) => {
          const result = await restartContainer(id, { onPhase });
          if (!result.ok) throw new Error('Container not found');
          return result;
        },
      });
      return { ok: true, operation: publicOperation(op) };
    },

    async deployer_container_stop({ id }) {
      const slotKey = String(id || '').trim();
      if (SYNC_LEGACY) {
        const result = await stopContainer(id);
        if (!result.ok) throw httpError('Container not found', 404);
        return { ok: true };
      }
      const op = enqueueOperation({
        kind: 'stop',
        slotKey,
        execute: async ({ onPhase }) => {
          const result = await stopContainer(id, { onPhase });
          if (!result.ok) throw new Error('Container not found');
          return result;
        },
      });
      return { ok: true, operation: publicOperation(op) };
    },

    async deployer_container_start({ id }) {
      const slotKey = String(id || '').trim();
      if (SYNC_LEGACY) {
        const result = await startContainer(id);
        if (!result.ok) throw httpError('Container not found', 404);
        return { ok: true };
      }
      const op = enqueueOperation({
        kind: 'start',
        slotKey,
        execute: async ({ onPhase }) => {
          const result = await startContainer(id, { onPhase });
          if (!result.ok) throw new Error('Container not found');
          return result;
        },
      });
      return { ok: true, operation: publicOperation(op) };
    },

    async deployer_container_delete({ id, removeData, templateId } = {}) {
      const remove = removeData === true || removeData === 'true' || removeData === 1 || removeData === '1';
      const tpl = typeof templateId === 'string' ? templateId.trim() : '';
      const slotKey = String(id || '').trim();
      if (remove && tpl && !getTemplateById(tpl)) throw httpError('Template not found', 404);
      if (SYNC_LEGACY) {
        const result = await deleteManagedContainer(id, remove, { templateId: tpl });
        return {
          ok: true,
          removed: result.removed,
          alreadyGone: result.alreadyGone,
          dataRemoved: result.dataRemoved || [],
          deprovisionWarning: result.deprovisionWarning || null,
        };
      }
      const op = enqueueOperation({
        kind: 'delete',
        slotKey,
        execute: async ({ onPhase }) => deleteManagedContainer(id, remove, { onPhase, templateId: tpl }),
      });
      return { ok: true, operation: publicOperation(op) };
    },

    async deployer_volume_manifest({ containerName, detail } = {}) {
      const manifest = getVolumeManifest(containerName, {
        detail: detail === true || detail === 'true' || detail === 1 || detail === '1',
      });
      return { ok: true, manifest };
    },

    async deployer_volume_import_session({ containerName }) {
      const session = createImportSession(containerName);
      return { ok: true, ...session };
    },

    async deployer_volume_transfer({ containerName, targetBaseUrl, importToken }) {
      const slotKey = `vol:${String(containerName).trim()}`;
      const op = enqueueOperation({
        kind: 'transfer',
        slotKey,
        execute: async ({ onPhase }) =>
          transferVolumeToTarget({ containerName, targetBaseUrl, importToken, onPhase }),
      });
      return { ok: true, operation: publicOperation(op) };
    },

    async deployer_volume_sync({ containerName, targetBaseUrl, importToken, mode } = {}) {
      const syncMode = String(mode || 'quiesced').trim() === 'hot' ? 'hot' : 'quiesced';
      const slotKey = `vol:${String(containerName).trim()}`;
      const op = enqueueOperation({
        kind: 'sync',
        slotKey,
        execute: async ({ onPhase }) =>
          syncVolumeToPeer({ containerName, targetBaseUrl, importToken, mode: syncMode, onPhase }),
      });
      return { ok: true, operation: publicOperation(op) };
    },

  };
}

module.exports = { createDeployerToolHandlers };
