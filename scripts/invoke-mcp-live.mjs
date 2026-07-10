#!/usr/bin/env node
/**
 * Live E2E: every Deployer MCP tool on real /mcp — success paths + expected negatives.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { createAllTools } = require('../server/mcp/toolRegistry');

const CRASH_RE =
  /is not a function|Cannot find module|is not defined|Unexpected token|ERR_|TypeError:|ReferenceError:/i;

const mcpJson = JSON.parse(readFileSync(join(__dirname, '../../.cursor/mcp.json'), 'utf8'));
const BASE = process.env.DEPLOYER_MCP_URL || mcpJson?.mcpServers?.deployer?.url || 'http://127.0.0.1:3000/mcp';
const KEY = (
  process.env.DEPLOYER_MCP_PROBE_KEY ||
  String(mcpJson?.mcpServers?.deployer?.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
).trim();

if (!KEY) {
  console.error('No deployer MCP key in .cursor/mcp.json');
  process.exit(2);
}

const SUFFIX = randomBytes(4).toString('hex');
const PROBE_TEMPLATE_ID = `mcp-live-tpl-${SUFFIX}`;
const CONTAINER_NAME = `mcp-live-${SUFFIX}`;
const HOST_PORT = String(40000 + (parseInt(SUFFIX.slice(0, 3), 16) % 10000));

const results = [];
let rpcId = 1;

function record(tool, phase, verdict, detail) {
  results.push({ tool, phase, verdict, detail });
  const icon = verdict === 'OK' ? 'OK' : verdict === 'EXPECTED_ERR' ? 'EXPECTED' : verdict;
  console.log(`${tool} | ${phase} | ${icon} | ${detail}`);
}

async function rpc(sessionId, method, params) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${KEY}`,
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params: params || {} }),
  });
  const sid = res.headers.get('mcp-session-id') || sessionId;
  const body = await res.json().catch(() => ({}));
  return { status: res.status, sid, body };
}

function parseToolResult(body) {
  if (body?.error) {
    return { verdict: 'FAIL', text: body.error.message || 'rpc_error', parsed: null, isError: true };
  }
  const r = body?.result;
  if (!r) return { verdict: 'FAIL', text: 'no_result', parsed: null, isError: true };
  const text = r.content?.[0]?.text || '';
  if (CRASH_RE.test(text)) {
    return { verdict: 'CRASH', text, parsed: null, isError: true };
  }
  if (r.isError) {
    return { verdict: 'BUSINESS_ERR', text, parsed: null, isError: true };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.ok === false) {
      const err = String(parsed.error || parsed.message || 'ok_false');
      if (CRASH_RE.test(err)) return { verdict: 'CRASH', text: err, parsed, isError: true };
      return { verdict: 'BUSINESS_ERR', text: err, parsed, isError: true };
    }
    return { verdict: 'OK', text, parsed, isError: false };
  } catch {
    return { verdict: 'OK', text, parsed: null, isError: false };
  }
}

async function callTool(sid, name, args = {}) {
  const res = await rpc(sid, 'tools/call', { name, arguments: args });
  if (res.status === 429) {
    return { sid: res.sid, verdict: 'FAIL', text: 'rate_limit_429', parsed: null, isError: true };
  }
  if (res.status !== 200) {
    return { sid: res.sid, verdict: 'FAIL', text: `http_${res.status}`, parsed: null, isError: true };
  }
  const parsed = parseToolResult(res.body);
  return { sid: res.sid, ...parsed };
}

async function pollOperation(sid, operationId, { timeoutMs = 120000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await callTool(sid, 'deployer_operation_get', { operationId });
    sid = r.sid;
    if (r.verdict !== 'OK') return { sid, op: null, error: r.text };
    const status = r.parsed?.operation?.status;
    if (status === 'succeeded' || status === 'failed') {
      return { sid, op: r.parsed.operation, error: status === 'failed' ? r.parsed.operation?.error : null };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { sid, op: null, error: 'poll_timeout' };
}

async function expectOk(sid, tool, args, check) {
  const r = await callTool(sid, tool, args);
  sid = r.sid;
  if (r.verdict !== 'OK') {
    record(tool, 'success', r.verdict, r.text?.slice(0, 120) || r.verdict);
    return { sid, ok: false, parsed: r.parsed };
  }
  if (check && !check(r.parsed)) {
    record(tool, 'success', 'FAIL', 'assertion_failed');
    return { sid, ok: false, parsed: r.parsed };
  }
  record(tool, 'success', 'OK', 'ok');
  return { sid, ok: true, parsed: r.parsed };
}

async function deleteContainerAndWait(sid, containerId) {
  const del = await callTool(sid, 'deployer_container_delete', { id: containerId });
  sid = del.sid;
  if (del.verdict !== 'OK' || !del.parsed?.operation?.operationId) {
    return { sid, ok: false, detail: del.text || del.verdict };
  }
  const polled = await pollOperation(sid, del.parsed.operation.operationId);
  sid = polled.sid;
  return { sid, ok: polled.op?.status === 'succeeded', detail: polled.op?.status || polled.error };
}

async function ensureDeploySlot(sid) {
  const cap = await callTool(sid, 'deployer_capacity_get');
  sid = cap.sid;
  const list = await callTool(sid, 'deployer_containers_list', { all: true, limit: 50 });
  sid = list.sid;
  const containers = list.parsed?.containers || [];
  const limit = list.parsed?.container_limit ?? cap.parsed?.container_limit ?? 1;
  if (containers.length < limit) return { sid, freed: 0 };

  const victims = containers.filter((c) => {
    const name = String(c.deployName || c.name || '');
    return /^mcp-live-/i.test(name) || /^mcp-probe-/i.test(name) || /^int-/i.test(name);
  });
  const toRemove = victims.length ? victims : containers.slice(0, 1);
  let freed = 0;
  for (const c of toRemove) {
    const id = c.id || c.name;
    if (!id) continue;
    console.log(`# freeing slot: delete ${c.deployName || c.name} (${id.slice(0, 12)}…)`);
    const res = await deleteContainerAndWait(sid, id);
    sid = res.sid;
    if (res.ok) freed += 1;
    if (containers.length - freed < limit) break;
  }
  return { sid, freed };
}

async function expectBusinessErr(sid, tool, args) {
  const r = await callTool(sid, tool, args);
  sid = r.sid;
  const ok = r.verdict === 'BUSINESS_ERR';
  record(tool, 'negative', ok ? 'EXPECTED_ERR' : r.verdict, r.text?.slice(0, 80) || r.verdict);
  return { sid, ok };
}

async function main() {
  console.log(`# Deployer MCP live E2E @ ${BASE}`);
  console.log(`# suffix=${SUFFIX} container=${CONTAINER_NAME} port=${HOST_PORT}\n`);

  let sid;
  const init = await rpc(null, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'invoke-mcp-live', version: '2' },
  });
  if (init.status !== 200 || !init.body?.result?.serverInfo) {
    console.error('INIT FAIL', init.status, JSON.stringify(init.body));
    process.exit(1);
  }
  sid = init.sid;
  console.log(`INIT OK | ${init.body.result.serverInfo.name} v${init.body.result.serverInfo.version}\n`);

  const toolsList = await rpc(sid, 'tools/list', {});
  sid = toolsList.sid;
  const listed = toolsList.body?.result?.tools || [];
  const registry = createAllTools();
  console.log(`TOOLS LIST | listed=${listed.length} registry=${registry.length}`);
  if (listed.length !== registry.length) {
    record('tools/list', 'meta', 'FAIL', `count mismatch listed=${listed.length} registry=${registry.length}`);
  } else {
    record('tools/list', 'meta', 'OK', `${listed.length} tools`);
  }

  const promptsList = await rpc(sid, 'prompts/list', {});
  sid = promptsList.sid;
  for (const p of promptsList.body?.result?.prompts || []) {
    const got = await rpc(sid, 'prompts/get', { name: p.name, arguments: {} });
    sid = got.sid;
    const ok = got.status === 200 && got.body?.result?.messages?.length;
    record(`prompt:${p.name}`, 'meta', ok ? 'OK' : 'FAIL', ok ? 'messages' : 'empty');
  }

  const resList = await rpc(sid, 'resources/list', {});
  sid = resList.sid;
  for (const r of resList.body?.result?.resources || []) {
    const got = await rpc(sid, 'resources/read', { uri: r.uri });
    sid = got.sid;
    const text = got.body?.result?.contents?.[0]?.text || '';
    const ok = got.status === 200 && text.length > 500;
    record(`resource:${r.uri}`, 'meta', ok ? 'OK' : 'FAIL', `${text.length} chars`);
  }

  console.log('\n# READ-ONLY TOOLS\n');

  let r;
  r = await expectOk(sid, 'deployer_capabilities', {}, (p) => p.access === 'full_api' && p.keyId);
  sid = r.sid;
  r = await expectOk(sid, 'deployer_health', {}, (p) => p.docker?.ok !== false);
  sid = r.sid;
  r = await expectOk(sid, 'deployer_version_get', {}, (p) => Boolean(p.version));
  sid = r.sid;
  r = await expectOk(sid, 'deployer_capacity_get', {}, (p) => typeof p.container_limit === 'number');
  sid = r.sid;
  r = await expectOk(sid, 'deployer_substitution_tokens_get', {}, (p) => Array.isArray(p.gen));
  sid = r.sid;
  r = await expectOk(sid, 'deployer_templates_list', {}, (p) => Array.isArray(p.templates));
  sid = r.sid;
  r = await expectOk(sid, 'deployer_template_get', { id: 'integration-smoke' }, (p) => p.template?.id === 'integration-smoke');
  sid = r.sid;
  r = await expectOk(sid, 'deployer_containers_list', { limit: 5 }, (p) => Array.isArray(p.containers));
  sid = r.sid;

  console.log('\n# TEMPLATE CRUD\n');

  r = await expectOk(sid, 'deployer_template_save', {
    template: {
      id: PROBE_TEMPLATE_ID,
      name: `MCP live probe ${SUFFIX}`,
      image: 'nginx:alpine',
      fields: [],
    },
  }, (p) => p.template?.id === PROBE_TEMPLATE_ID);
  sid = r.sid;

  r = await expectOk(sid, 'deployer_template_get', { id: PROBE_TEMPLATE_ID }, (p) => p.template?.id === PROBE_TEMPLATE_ID);
  sid = r.sid;

  r = await expectBusinessErr(sid, 'deployer_template_delete', { id: 'mcp-no-such-template-xyz' });
  sid = r.sid;

  console.log('\n# DEPLOY + OPERATION POLL\n');

  ({ sid } = await ensureDeploySlot(sid));

  r = await expectOk(sid, 'deployer_deploy', {
    templateId: 'integration-smoke',
    containerName: CONTAINER_NAME,
    params: { HOST_PORT },
  }, (p) => Boolean(p.operation?.operationId));
  sid = r.sid;
  const deployOpId = r.parsed?.operation?.operationId;
  if (!deployOpId) {
    console.error('deploy did not return operationId');
    process.exit(1);
  }

  const deployPoll = await pollOperation(sid, deployOpId);
  sid = deployPoll.sid;
  if (!deployPoll.op || deployPoll.op.status !== 'succeeded') {
    record('deployer_deploy', 'poll', 'FAIL', deployPoll.error || deployPoll.op?.status || 'no_op');
    process.exit(1);
  }
  record('deployer_operation_get', 'deploy_poll', 'OK', `status=${deployPoll.op.status}`);

  const containerId = deployPoll.op.result?.container?.id;
  if (!containerId) {
    record('deployer_deploy', 'poll', 'FAIL', 'no container id in result');
    process.exit(1);
  }

  console.log('\n# CONTAINER READ\n');

  r = await expectOk(sid, 'deployer_container_get', { id: containerId }, (p) => p.container?.id === containerId);
  sid = r.sid;
  r = await expectOk(sid, 'deployer_container_stats', { id: containerId }, (p) => p.stats != null);
  sid = r.sid;
  r = await expectOk(sid, 'deployer_container_disk', { id: containerId }, (p) => p.disk != null);
  sid = r.sid;
  r = await expectOk(sid, 'deployer_container_logs', { id: containerId, tail: 20 }, (p) => typeof p.logs === 'string');
  sid = r.sid;

  console.log('\n# CONTAINER LIFECYCLE\n');

  async function lifecycle(tool) {
    const call = await expectOk(sid, tool, { id: containerId }, (p) => Boolean(p.operation?.operationId));
    sid = call.sid;
    if (!call.ok) return call;
    const polled = await pollOperation(sid, call.parsed.operation.operationId);
    sid = polled.sid;
    const ok = polled.op?.status === 'succeeded';
    record(tool, 'poll', ok ? 'OK' : 'FAIL', polled.error || polled.op?.status || 'timeout');
    return { sid, ok };
  }

  ({ sid } = await lifecycle('deployer_container_stop'));
  ({ sid } = await lifecycle('deployer_container_start'));
  ({ sid } = await lifecycle('deployer_container_restart'));

  console.log('\n# VOLUME TOOLS\n');

  r = await expectOk(sid, 'deployer_volume_manifest', { containerName: CONTAINER_NAME }, (p) => p.manifest?.containerName);
  sid = r.sid;

  r = await expectOk(sid, 'deployer_volume_import_session', { containerName: CONTAINER_NAME }, (p) => Boolean(p.importToken));
  sid = r.sid;
  const importToken = r.parsed?.importToken;

  r = await expectOk(sid, 'deployer_volume_transfer', {
    containerName: CONTAINER_NAME,
    targetBaseUrl: 'http://127.0.0.1:39999',
    importToken: importToken || 'invalid',
  }, (p) => Boolean(p.operation?.operationId));
  sid = r.sid;
  if (r.parsed?.operation?.operationId) {
    const transferPoll = await pollOperation(sid, r.parsed.operation.operationId, { timeoutMs: 30000 });
    sid = transferPoll.sid;
    record('deployer_volume_transfer', 'poll', transferPoll.op ? 'OK' : 'FAIL', transferPoll.op?.status || transferPoll.error);
  }

  r = await expectOk(sid, 'deployer_volume_sync', {
    containerName: CONTAINER_NAME,
    targetBaseUrl: 'http://127.0.0.1:39999',
    importToken: 'invalid-token',
    mode: 'quiesced',
  }, (p) => Boolean(p.operation?.operationId));
  sid = r.sid;
  if (r.parsed?.operation?.operationId) {
    const syncPoll = await pollOperation(sid, r.parsed.operation.operationId, { timeoutMs: 30000 });
    sid = syncPoll.sid;
    record('deployer_volume_sync', 'poll', syncPoll.op ? 'OK' : 'FAIL', syncPoll.op?.status || syncPoll.error);
  }

  console.log('\n# DELETE CONTAINER\n');

  r = await expectOk(sid, 'deployer_container_delete', { id: containerId }, (p) => Boolean(p.operation?.operationId));
  sid = r.sid;
  if (r.ok && r.parsed?.operation?.operationId) {
    const delPoll = await pollOperation(sid, r.parsed.operation.operationId);
    sid = delPoll.sid;
    record('deployer_container_delete', 'poll', delPoll.op?.status === 'succeeded' ? 'OK' : 'FAIL', delPoll.op?.status || delPoll.error);
  }

  r = await expectBusinessErr(sid, 'deployer_operation_get', { operationId: '00000000-0000-0000-0000-000000000000' });
  sid = r.sid;

  console.log('\n# TEMPLATE CLEANUP\n');

  r = await expectOk(sid, 'deployer_template_delete', { id: PROBE_TEMPLATE_ID });
  sid = r.sid;

  console.log('\n# SUMMARY\n');

  const toolsTouched = new Set(results.map((x) => x.tool.replace(/^prompt:|^resource:/, '')));
  const registryNames = registry.map((t) => t.name);
  const missing = registryNames.filter((n) => !results.some((x) => x.tool === n));

  const stats = { OK: 0, EXPECTED_ERR: 0, FAIL: 0, CRASH: 0, BUSINESS_ERR: 0 };
  for (const row of results) {
    const k = row.verdict === 'EXPECTED_ERR' ? 'EXPECTED_ERR' : row.verdict;
    stats[k] = (stats[k] || 0) + 1;
  }

  const broken = results.filter((x) => x.verdict === 'FAIL' || x.verdict === 'CRASH');
  const toolSuccess = registryNames.map((name) => {
    const rows = results.filter((x) => x.tool === name);
    const worked =
      rows.some((x) => x.verdict === 'OK' && ['success', 'poll', 'deploy_poll'].includes(x.phase)) ||
      rows.some((x) => x.verdict === 'EXPECTED_ERR' && x.phase === 'negative');
    return { name, worked, rows: rows.length };
  });

  console.log(JSON.stringify({
    base: BASE,
    suffix: SUFFIX,
    tools_listed: listed.length,
    tools_registry: registry.length,
    tools_exercised: registryNames.length - missing.length,
    tools_missing_from_run: missing,
    ...stats,
    broken_count: broken.length,
  }, null, 2));

  console.log('\n# PER-TOOL STATUS\n');
  for (const t of toolSuccess) {
    const mark = t.worked ? 'PASS' : 'FAIL';
    console.log(`${t.name} | ${mark}`);
  }

  if (broken.length) {
    console.log('\n# BROKEN\n');
    broken.forEach((x) => console.log(`${x.tool} | ${x.phase} | ${x.detail}`));
  }

  const allToolsPass = toolSuccess.every((t) => t.worked);

  process.exit(broken.length > 0 || !allToolsPass ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
