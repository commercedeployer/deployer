const { parseBearerAuthorization, isMcpBearerToken } = require('./mcpKeyCrypto');
const mcpKeyStore = require('./mcpKeyStore');

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

function createMcpKeyAuth({ sessionSecret }) {
  return async function mcpKeyAuth(req, res, next) {
    const token = parseBearerAuthorization(req.headers.authorization);
    if (!token || !isMcpBearerToken(token)) {
      const err = new Error('MCP bearer token required');
      err.status = 401;
      err.code = 'unauthorized';
      return next(err);
    }
    try {
      const row = mcpKeyStore.resolveFromPlaintext(token, sessionSecret);
      if (!row) {
        const err = new Error('Invalid or revoked MCP key');
        err.status = 401;
        err.code = 'unauthorized';
        return next(err);
      }
      req.mcpActor = {
        keyId: row.key_id,
        label: row.label,
        createdBy: row.created_by,
      };
      req.mcpKeyPlaintext = token;
      const ip = clientIp(req);
      mcpKeyStore.touchUsage(row.key_id, ip);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { createMcpKeyAuth, clientIp };
