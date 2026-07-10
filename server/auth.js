/**
 * Authentication: single env user, bcrypt, session, rate limit.
 */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

let passwordHash = null;

function getPasswordHash() {
  if (passwordHash) return passwordHash;
  if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD not set');
  passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  return passwordHash;
}

function verifyPassword(username, password) {
  if (username !== ADMIN_USER) return false;
  const hash = getPasswordHash();
  return bcrypt.compareSync(password, hash);
}

function getSessionSecret() {
  if (process.env.NODE_ENV !== 'production' && (!SESSION_SECRET || SESSION_SECRET === 'change-me-in-production')) {
    console.warn('Warning: SESSION_SECRET not set or default. Set SESSION_SECRET in production.');
  }
  return SESSION_SECRET;
}

const API_KEY = process.env.API_KEY || '';

function isApiKeyValid(key) {
  if (API_KEY === '' || typeof key !== 'string' || key.length === 0) return false;
  const expected = Buffer.from(API_KEY, 'utf8');
  const actual = Buffer.from(key, 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hasApiKeyConfigured() {
  return typeof API_KEY === 'string' && API_KEY.length > 0;
}

/** @returns {'dual'|'api'|'ui'} */
function getDeployAuthMode() {
  const raw = String(process.env.DEPLOYER_AUTH_MODE || 'dual').trim().toLowerCase();
  if (['dual', 'both', 'ui+api', 'ui_api', 'ui-api'].includes(raw)) return 'dual';
  if (['api', 'api-only', 'api_only'].includes(raw)) return 'api';
  if (['ui', 'session', 'ui-only', 'ui_only'].includes(raw)) return 'ui';
  console.warn(`Unknown DEPLOYER_AUTH_MODE=${raw}, using dual`);
  return 'dual';
}

const DEPLOY_AUTH_MODE = getDeployAuthMode();

function hasValidSession(req) {
  return Boolean(req.session && req.session.user === ADMIN_USER);
}

function requireAuth(req, res, next) {
  if (hasValidSession(req)) return next();
  const apiKey = req.headers['x-api-key'];
  if (isApiKeyValid(apiKey)) return next();
  const path = String(req.path || req.url || '').split('?')[0];
  if (path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login.html');
}

/**
 * Deploy / operations auth policy (DEPLOYER_AUTH_MODE):
 * - dual (default): web session OR x-api-key
 * - api: when API_KEY set — only x-api-key; otherwise session
 * - ui: only web session
 */
function requireDeployAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const sessionOk = hasValidSession(req);
  const keyOk = isApiKeyValid(apiKey);

  if (DEPLOY_AUTH_MODE === 'dual') {
    if (sessionOk || keyOk) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (DEPLOY_AUTH_MODE === 'api') {
    if (hasApiKeyConfigured()) {
      if (keyOk) return next();
      return res.status(401).json({ error: 'Unauthorized: valid x-api-key required for deploy API' });
    }
    if (sessionOk) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (sessionOk) return next();
  return res.status(401).json({ error: 'Unauthorized: web session required for deploy API' });
}

module.exports = {
  ADMIN_USER,
  API_KEY,
  verifyPassword,
  getSessionSecret,
  requireAuth,
  requireDeployAuth,
  isApiKeyValid,
  hasApiKeyConfigured,
  getDeployAuthMode,
  DEPLOY_AUTH_MODE,
  hasValidSession,
};
