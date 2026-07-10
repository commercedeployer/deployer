/** Deploy-time MCP tool denylist (comma-separated env). */

function parseMcpToolsDeny(raw) {
  if (raw == null || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isToolDeniedByPolicy(toolName, denied) {
  if (!denied?.size) return false;
  return denied.has(String(toolName || '').trim().toLowerCase());
}

function filterToolsByDenyPolicy(tools, denied) {
  if (!denied?.size) return tools;
  return tools.filter((t) => !isToolDeniedByPolicy(t.name, denied));
}

function assertToolNotDeniedByPolicy(toolName, denied) {
  if (isToolDeniedByPolicy(toolName, denied)) {
    const err = new Error('tool_disabled_by_policy');
    err.code = 'tool_disabled_by_policy';
    throw err;
  }
}

module.exports = {
  parseMcpToolsDeny,
  isToolDeniedByPolicy,
  filterToolsByDenyPolicy,
  assertToolNotDeniedByPolicy,
};
