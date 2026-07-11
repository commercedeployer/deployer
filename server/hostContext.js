/**
 * Deployer host env keys available in provision steps and template substitution.
 * Postgres admin URL belongs in the template provision.env — not Deployer process env.
 */
const HOST_ENV_KEYS = [
  'DEPLOY_BASE_PATH',
  'SHARED_APP_NETWORK',
];

function deployHostContext() {
  const ctx = {};
  for (const key of HOST_ENV_KEYS) {
    const val = process.env[key];
    if (val != null && String(val).trim() !== '') ctx[key] = String(val).trim();
  }
  if (!ctx.DEPLOY_BASE_PATH) {
    ctx.DEPLOY_BASE_PATH = (process.env.DEPLOY_BASE_PATH || '/opt/deploy-data').replace(/\/+$/, '');
  }
  return ctx;
}

module.exports = {
  HOST_ENV_KEYS,
  deployHostContext,
};
