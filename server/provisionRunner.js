/**
 * Provision / deprovision steps on host (spawn). Template-driven; no DB-specific logic.
 */
const { spawn } = require('child_process');
const { createGenCache } = require('./genTokens');
const { substitute } = require('./templates');
const { normalizeDockerContainerName } = require('./deployIdentity');

const DEFAULT_TIMEOUT_MS = Math.max(
  5000,
  parseInt(process.env.PROVISION_TIMEOUT_MS || '120000', 10) || 120000,
);

function normalizeSteps(block) {
  if (!block) return [];
  if (Array.isArray(block)) return block.filter((s) => s && typeof s === 'object');
  if (typeof block === 'object') return [block];
  return [];
}

function buildSubstitutionContext({ containerName, params = {}, deployBasePath, genCache }) {
  const dockerName = normalizeDockerContainerName(containerName);
  const basePath = (deployBasePath || process.env.DEPLOY_BASE_PATH || '/opt/deploy-data').replace(/\/+$/, '');
  const cache = genCache || createGenCache();
  const subs = { ...params, CONTAINER_NAME: dockerName };
  const ctx = {
    genCache: cache,
    deployBasePath: basePath,
    DEPLOY_BASE_PATH: basePath,
  };
  return { subs, ctx };
}

function parseStdoutJson(stdout, expectKeys) {
  const text = String(stdout || '').trim();
  if (!text) {
    if (expectKeys.length === 0) return {};
    throw new Error('provision_empty_stdout');
  }
  const tryParse = (chunk) => {
    const obj = JSON.parse(chunk);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('provision_invalid_json');
    }
    return obj;
  };
  let parsed;
  try {
    parsed = tryParse(text);
  } catch {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    parsed = tryParse(last);
  }
  for (const key of expectKeys) {
    if (parsed[key] == null || String(parsed[key]).trim() === '') {
      throw new Error(`provision_missing_key:${key}`);
    }
  }
  return parsed;
}

function runChildProcess(command, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('provision_timeout'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = (stderr || stdout || `exit ${code}`).trim().slice(0, 500);
        const err = new Error(msg || 'provision_command_failed');
        err.exitCode = code;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runStep(step, subs, ctx, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const commandRaw = step.command;
  if (!commandRaw || typeof commandRaw !== 'string' || !commandRaw.trim()) {
    throw new Error('provision_missing_command');
  }
  const command = substitute(commandRaw.trim(), subs, ctx);
  const args = (Array.isArray(step.args) ? step.args : []).map((a) => substitute(String(a ?? ''), subs, ctx));
  const expect = Array.isArray(step.expect)
    ? step.expect.map((k) => String(k).trim()).filter(Boolean)
    : [];
  const childEnv = { ...process.env };
  const stepEnv = step.env && typeof step.env === 'object' ? step.env : {};
  for (const [key, value] of Object.entries(stepEnv)) {
    childEnv[key] = substitute(String(value ?? ''), subs, ctx);
  }
  const { stdout } = await runChildProcess(command, args, childEnv, timeoutMs);
  if (expect.length === 0) return {};
  return parseStdoutJson(stdout, expect);
}

async function runProvisionBlock(block, options, hooks = {}) {
  const steps = normalizeSteps(block);
  if (steps.length === 0) return {};
  const onPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : () => {};
  const failPhase = hooks.failPhase || 'provision_failed';
  const { subs, ctx } = buildSubstitutionContext(options);
  const outputs = {};
  for (let i = 0; i < steps.length; i += 1) {
    onPhase('provisioning', `Provision step ${i + 1}/${steps.length}`);
    try {
      const stepOut = await runStep(steps[i], { ...subs, ...outputs }, { ...ctx, ...outputs }, hooks);
      Object.assign(outputs, stepOut);
      Object.assign(subs, stepOut);
      Object.assign(ctx, stepOut);
    } catch (err) {
      const e = new Error(err?.message || 'provision_failed');
      e.phase = failPhase;
      throw e;
    }
  }
  return outputs;
}

function resolveDeleteTemplateId(queryTemplateId, containerInspect) {
  const q = String(queryTemplateId || '').trim();
  if (q) return q;
  if (containerInspect) {
    const { templateIdFromLabels } = require('./deployIdentity');
    return templateIdFromLabels(containerInspect.Config?.Labels || {});
  }
  return '';
}

function resolveDeployIdentifier(idOrName, containerInspect) {
  if (containerInspect) {
    const fromLabel = (containerInspect.Config?.Labels || {})[require('./deployIdentity').INSTANCE_LABEL];
    if (fromLabel) return String(fromLabel).trim();
  }
  return normalizeDockerContainerName(idOrName);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  normalizeSteps,
  buildSubstitutionContext,
  runProvisionBlock,
  runStep,
  resolveDeleteTemplateId,
  resolveDeployIdentifier,
};
