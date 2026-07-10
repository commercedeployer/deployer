const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createMcpKeyAuth } = require('./mcpAuth');
const { createAllTools } = require('./toolRegistry');
const { createPromptRegistry, createResourceRegistry } = require('./resources');
const { createMcpConcurrencyGate } = require('./concurrencyGate');
const { mcpConfig } = require('./mcpKeyService');
const {
  filterToolsByDenyPolicy,
  assertToolNotDeniedByPolicy,
} = require('./toolPolicy');

const PROTOCOL_VERSION = '2025-06-18';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toolToMcpSchema(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.destructive ? { destructiveHint: true } : undefined,
  };
}

function hashArgs(args) {
  return crypto.createHash('sha256').update(JSON.stringify(args || {})).digest('hex').slice(0, 16);
}

function createMcpServer() {
  const config = mcpConfig();
  const allTools = createAllTools();
  const toolByName = new Map(allTools.map((t) => [t.name, t]));
  const prompts = createPromptRegistry();
  const resources = createResourceRegistry();
  const sessions = new Map();

  function pruneSessions() {
    const now = Date.now();
    for (const [id, row] of sessions) {
      if (now - row.createdAt > SESSION_TTL_MS) sessions.delete(id);
    }
  }

  function createSession(keyId) {
    pruneSessions();
    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions.set(sessionId, { keyId: String(keyId), createdAt: Date.now() });
    return sessionId;
  }

  function touchSession(sessionId, keyId) {
    const row = sessions.get(String(sessionId || ''));
    if (!row || row.keyId !== String(keyId)) return false;
    row.createdAt = Date.now();
    return true;
  }

  function setMcpProtocolHeaders(res, sessionId) {
    res.setHeader('MCP-Protocol-Version', PROTOCOL_VERSION);
    if (sessionId) res.setHeader('Mcp-Session-Id', sessionId);
  }

  function requireMcpSession(req, res, next) {
    const method = req.body?.method;
    if (method === 'initialize') return next();
    const sessionId = req.get('mcp-session-id');
    if (!touchSession(sessionId, req.mcpActor?.keyId)) {
      return res.status(404).json(jsonRpcError(req.body?.id ?? null, -32600, 'Invalid or expired MCP session'));
    }
    return next();
  }

  const mcpAuth = createMcpKeyAuth({ sessionSecret: config.sessionSecret });
  const rateLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxPerWindow,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `mcp:${req.mcpActor?.keyId || req.ip}`,
    handler: (req, res) => {
      res.status(429).json({ ok: false, error: 'mcp_rate_limited' });
    },
  });

  const toolCallGate = createMcpConcurrencyGate(config.concurrency);

  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));

  router.get('/.well-known/oauth-protected-resource', (req, res) => {
    const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    res.json({
      resource: `${base.replace(/\/$/, '')}/mcp`,
      authorization_servers: [],
      bearer_methods_supported: ['header'],
      resource_documentation: `${base.replace(/\/$/, '')}/docs/DEPLOYER-MCP-v1-RU.md`,
    });
  });

  router.get('/', mcpAuth, (req, res) => {
    setMcpProtocolHeaders(res);
    res.setHeader('Allow', 'POST, DELETE');
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
  });

  router.delete('/', mcpAuth, (req, res) => {
    const sessionId = req.get('mcp-session-id');
    if (sessionId) sessions.delete(String(sessionId));
    setMcpProtocolHeaders(res);
    res.status(204).end();
  });

  router.post('/', mcpAuth, requireMcpSession, rateLimiter, async (req, res) => {
    const actor = req.mcpActor;
    const body = req.body;
    const id = body?.id ?? null;
    const method = body?.method;

    if (!body || body.jsonrpc !== '2.0' || !method) {
      return res.status(400).json(jsonRpcError(id, -32600, 'Invalid Request'));
    }

    const ctx = { actor };

    try {
      if (method === 'initialize') {
        const sessionId = createSession(actor.keyId);
        setMcpProtocolHeaders(res, sessionId);
        return res.json(
          jsonRpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: true },
              prompts: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
            },
            serverInfo: { name: 'deployer-mcp', version: require('../../package.json').version },
          }),
        );
      }

      setMcpProtocolHeaders(res, req.get('mcp-session-id'));

      if (method === 'notifications/initialized') {
        return res.status(204).end();
      }

      if (method === 'tools/list') {
        return res.json(
          jsonRpcResult(id, {
            tools: filterToolsByDenyPolicy(allTools, config.toolsDeny).map(toolToMcpSchema),
          }),
        );
      }

      if (method === 'tools/call') {
        const toolName = body.params?.name;
        const args = body.params?.arguments || {};
        const tool = toolByName.get(toolName);
        if (!tool) return res.status(404).json(jsonRpcError(id, -32601, `Unknown tool: ${toolName}`));

        assertToolNotDeniedByPolicy(toolName, config.toolsDeny);

        let data;
        try {
          data = await toolCallGate.run(() => tool.handler(ctx, args));
        } catch (gateErr) {
          if (gateErr?.code === 'mcp_server_busy' || gateErr?.code === 'mcp_queue_timeout') {
            return res.status(503).json(jsonRpcError(id, -32000, gateErr.message));
          }
          throw gateErr;
        }
        const text = JSON.stringify(data, null, 2);
        return res.json(
          jsonRpcResult(id, {
            content: [{ type: 'text', text }],
            structuredContent: data,
            isError: false,
          }),
        );
      }

      if (method === 'prompts/list') {
        return res.json(jsonRpcResult(id, { prompts: prompts.prompts }));
      }

      if (method === 'prompts/get') {
        const name = body.params?.name;
        const prompt = await prompts.getPrompt(name);
        return res.json(jsonRpcResult(id, prompt));
      }

      if (method === 'resources/list') {
        return res.json(jsonRpcResult(id, { resources: resources.staticResources }));
      }

      if (method === 'resources/templates/list') {
        return res.json(jsonRpcResult(id, { resourceTemplates: resources.templates }));
      }

      if (method === 'resources/read') {
        const uri = body.params?.uri;
        const content = await resources.readResource(uri);
        return res.json(
          jsonRpcResult(id, {
            contents: [{ uri, mimeType: content.mimeType, text: content.text }],
          }),
        );
      }

      return res.status(404).json(jsonRpcError(id, -32601, `Method not found: ${method}`));
    } catch (err) {
      const message = err?.message || String(err);
      if (method === 'tools/call') {
        return res.json(
          jsonRpcResult(id, {
            content: [{ type: 'text', text: message }],
            isError: true,
          }),
        );
      }
      return res.status(500).json(jsonRpcError(id, -32603, message));
    }
  });

  router.use((err, req, res, next) => {
    if (err?.status === 401 || err?.code === 'unauthorized') {
      const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
      res.setHeader(
        'WWW-Authenticate',
        `Bearer realm="deployer-mcp", resource_metadata="${base.replace(/\/$/, '')}/mcp/.well-known/oauth-protected-resource"`,
      );
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    return next(err);
  });

  return router;
}

module.exports = { createMcpServer, hashArgs };
