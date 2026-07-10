const { createDeployerToolHandlers } = require('./toolHandlers');

function tool(name, opts, handler) {
  return {
    name,
    title: opts.title || name,
    description: opts.description || '',
    inputSchema: opts.inputSchema || { type: 'object', properties: {} },
    destructive: Boolean(opts.destructive),
    handler,
  };
}

function createAllTools() {
  const h = createDeployerToolHandlers();

  return [
    tool('deployer_capabilities', {
      title: 'Deployer MCP capabilities',
      description: 'Server identity, auth mode and MCP key metadata',
    }, (ctx) => h.deployer_capabilities_ctx(ctx)),

    tool('deployer_health', {
      description: 'Process health and Docker probe',
    }, () => h.deployer_health()),

    tool('deployer_version_get', {
      description: 'Deployer package version and auth mode',
    }, () => h.deployer_version_get()),

    tool('deployer_capacity_get', {
      description: 'Host capacity snapshot (CPU, memory, disk, container slots)',
    }, () => h.deployer_capacity_get()),

    tool('deployer_substitution_tokens_get', {
      description: 'Template substitution tokens (GEN_*, DEPLOY_BASE_PATH)',
    }, () => h.deployer_substitution_tokens_get()),

    tool('deployer_templates_list', {
      description: 'List deploy templates',
    }, () => h.deployer_templates_list()),

    tool('deployer_template_get', {
      description: 'Get full template JSON by id',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_template_get(args)),

    tool('deployer_template_save', {
      description: 'Create or update a template',
      inputSchema: {
        type: 'object',
        properties: { template: { type: 'object' } },
        required: ['template'],
      },
    }, (_ctx, args) => h.deployer_template_save(args)),

    tool('deployer_template_delete', {
      description: 'Delete template by id',
      destructive: true,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_template_delete(args)),

    tool('deployer_deploy', {
      description: 'Deploy container from template (async 202 operation unless DEPLOYER_SYNC_LEGACY=1)',
      destructive: true,
      inputSchema: {
        type: 'object',
        properties: {
          templateId: { type: 'string' },
          containerName: { type: 'string' },
          params: { type: 'object' },
        },
        required: ['templateId', 'containerName', 'params'],
      },
    }, (_ctx, args) => h.deployer_deploy(args)),

    tool('deployer_operation_get', {
      description: 'Poll async operation status by operationId',
      inputSchema: {
        type: 'object',
        properties: { operationId: { type: 'string' } },
        required: ['operationId'],
      },
    }, (_ctx, args) => h.deployer_operation_get(args)),

    tool('deployer_containers_list', {
      description: 'List managed containers with pagination and optional search',
      inputSchema: {
        type: 'object',
        properties: {
          all: { type: 'boolean' },
          q: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' },
        },
      },
    }, (_ctx, args) => h.deployer_containers_list(args)),

    tool('deployer_container_get', {
      description: 'Container details; optional stats and full inspect',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          stats: { type: 'boolean' },
          inspect: { type: 'boolean' },
        },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_get(args)),

    tool('deployer_container_stats', {
      description: 'Live CPU/memory stats for container',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_stats(args)),

    tool('deployer_container_disk', {
      description: 'Disk usage for container mounts',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_disk(args)),

    tool('deployer_container_logs', {
      description: 'Container stdout/stderr logs',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tail: { type: 'string' },
          timestamps: { type: 'boolean' },
        },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_logs(args)),

    tool('deployer_container_restart', {
      description: 'Restart container (async operation)',
      destructive: true,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_restart(args)),

    tool('deployer_container_stop', {
      description: 'Stop container (async operation)',
      destructive: true,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_stop(args)),

    tool('deployer_container_start', {
      description: 'Start stopped container (async operation)',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_start(args)),

    tool('deployer_container_delete', {
      description: 'Delete container; optional removeData + templateId for data wipe',
      destructive: true,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          removeData: { type: 'boolean' },
          templateId: { type: 'string' },
        },
        required: ['id'],
      },
    }, (_ctx, args) => h.deployer_container_delete(args)),

    tool('deployer_volume_manifest', {
      description: 'Volume manifest for container data directory',
      inputSchema: {
        type: 'object',
        properties: {
          containerName: { type: 'string' },
          detail: { type: 'boolean' },
        },
        required: ['containerName'],
      },
    }, (_ctx, args) => h.deployer_volume_manifest(args)),

    tool('deployer_volume_import_session', {
      description: 'Create one-time import session token for volume upload',
      inputSchema: {
        type: 'object',
        properties: { containerName: { type: 'string' } },
        required: ['containerName'],
      },
    }, (_ctx, args) => h.deployer_volume_import_session(args)),

    tool('deployer_volume_transfer', {
      description: 'Transfer volume archive to peer Deployer (async)',
      destructive: true,
      inputSchema: {
        type: 'object',
        properties: {
          containerName: { type: 'string' },
          targetBaseUrl: { type: 'string' },
          importToken: { type: 'string' },
        },
        required: ['containerName', 'targetBaseUrl', 'importToken'],
      },
    }, (_ctx, args) => h.deployer_volume_transfer(args)),

    tool('deployer_volume_sync', {
      description: 'Sync volume to peer Deployer (quiesced or hot mode)',
      destructive: true,
      inputSchema: {
        type: 'object',
        properties: {
          containerName: { type: 'string' },
          targetBaseUrl: { type: 'string' },
          importToken: { type: 'string' },
          mode: { type: 'string', enum: ['quiesced', 'hot'] },
        },
        required: ['containerName', 'targetBaseUrl', 'importToken'],
      },
    }, (_ctx, args) => h.deployer_volume_sync(args)),
  ];
}

module.exports = { createAllTools, tool };
