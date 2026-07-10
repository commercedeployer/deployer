const express = require('express');
const { hasValidSession } = require('../auth');
const {
  buildMcpKeyRecord,
  sanitizeListRow,
  assertQuotaAvailable,
  buildCursorMcpConfig,
  listKeysSummary,
  mcpConfig,
} = require('../mcp/mcpKeyService');
const mcpKeyStore = require('../mcp/mcpKeyStore');

function requireUiSession(req, res, next) {
  if (hasValidSession(req)) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

function createMcpKeyRoutes() {
  const router = express.Router();
  const config = mcpConfig();

  function publicBase(req) {
    if (config.publicBaseUrl) return config.publicBaseUrl;
    return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
  }

  router.get('/api/v1/mcp/keys', requireUiSession, (req, res) => {
    res.json(listKeysSummary(publicBase(req)));
  });

  router.post('/api/v1/mcp/keys', requireUiSession, express.json(), (req, res) => {
    try {
      assertQuotaAvailable();
      const { record, plaintext } = buildMcpKeyRecord({
        label: req.body?.label,
        createdBy: 'admin',
      });
      mcpKeyStore.insertKey(record);
      res.status(201).json({
        ok: true,
        key: sanitizeListRow(record),
        plaintext,
        cursorConfig: buildCursorMcpConfig(publicBase(req), plaintext),
      });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({
        ok: false,
        error: err.message,
        code: err.code,
        details: err.limit != null ? { limit: err.limit } : undefined,
      });
    }
  });

  router.post('/api/v1/mcp/keys/:keyId/revoke', requireUiSession, express.json(), (req, res) => {
    const existing = mcpKeyStore.getKeyById(req.params.keyId);
    if (!existing) return res.status(404).json({ ok: false, error: 'MCP key not found' });
    if (existing.status !== 'active') {
      return res.status(400).json({ ok: false, error: 'Key already revoked', code: 'already_revoked' });
    }
    const row = mcpKeyStore.revokeKey(req.params.keyId);
    res.json({ ok: true, key: sanitizeListRow(row) });
  });

  return router;
}

module.exports = { createMcpKeyRoutes };
