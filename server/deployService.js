/**
 * Shared deploy execution used by HTTP routes and MCP tools.
 */
const { loadTemplates } = require('./templates');
const {
  normalizeTemplateShape,
  fillDefaults,
  applyParams,
  getTemplateById,
} = require('./templates');
const { createGenCache } = require('./genTokens');
const { runProvisionBlock } = require('./provisionRunner');
const { resolveSlotKey } = require('./deployIdentity');
const { createAndStart } = require('./docker');

function deployContext() {
  return { deployBasePath: process.env.DEPLOY_BASE_PATH || '/opt/deploy-data' };
}

async function executeDeploy({ template, containerName, params, onPhase }) {
  const ctx = deployContext();
  const genCache = createGenCache();
  const ctxWithName = { ...ctx, containerName, genCache };
  const normalized = normalizeTemplateShape(template);
  const paramsCopy = params && typeof params === 'object' ? { ...params } : {};
  let filled = fillDefaults(normalized, paramsCopy, ctxWithName);
  if (template.provision) {
    onPhase?.('provisioning', 'Running provision');
    const outputs = await runProvisionBlock(
      template.provision,
      { containerName, params: filled, deployBasePath: ctx.deployBasePath },
      { onPhase },
    );
    filled = { ...filled, ...outputs };
  }
  const { spec, filled: finalFilled } = applyParams(template, filled, ctxWithName);
  const slotKey = resolveSlotKey(containerName);
  const container = await createAndStart(spec, {
    onPhase,
    deployName: slotKey,
    templateId: template.id,
  });
  if (template.postStart) {
    onPhase?.('post_start', 'Running post-start');
    await runProvisionBlock(
      template.postStart,
      { containerName, params: finalFilled, deployBasePath: ctx.deployBasePath },
      { onPhase, failPhase: 'post_start_failed' },
    );
  }
  return { container, params: finalFilled };
}

function findTemplate(templateId) {
  if (typeof templateId !== 'string' || !templateId.trim()) return null;
  return getTemplateById(templateId) || loadTemplates().find((t) => t.id === templateId) || null;
}

module.exports = {
  deployContext,
  executeDeploy,
  findTemplate,
};
