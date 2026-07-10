const crypto = require('node:crypto');

const KEY_PREFIX = 'dep_mcp_live_';

function hashMcpKey(plaintext, pepper) {
  return crypto.createHmac('sha256', String(pepper || 'dev-deployer-mcp-pepper')).update(String(plaintext)).digest('hex');
}

function generateMcpKeyPlaintext() {
  const secret = crypto.randomBytes(24).toString('hex');
  return `${KEY_PREFIX}${secret}`;
}

function keyPrefixFromPlaintext(plaintext) {
  const s = String(plaintext || '');
  if (s.length <= 12) return s;
  return `${s.slice(0, 12)}…${s.slice(-4)}`;
}

function isMcpBearerToken(value) {
  return typeof value === 'string' && value.startsWith(KEY_PREFIX) && value.length > KEY_PREFIX.length + 8;
}

function parseBearerAuthorization(header) {
  if (!header) return null;
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

module.exports = {
  KEY_PREFIX,
  hashMcpKey,
  generateMcpKeyPlaintext,
  keyPrefixFromPlaintext,
  isMcpBearerToken,
  parseBearerAuthorization,
};
