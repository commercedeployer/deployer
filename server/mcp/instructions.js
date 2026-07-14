const fs = require('node:fs');
const path = require('node:path');

const DOC_ROOT = path.join(__dirname, '..', '..', 'docs');
const INSTRUCTIONS_MAX = 12000;

function loadServerInstructions() {
  const file = path.join(DOC_ROOT, 'DEPLOYER-MCP-AGENT-RU.md');
  if (!fs.existsSync(file)) {
    return [
      'Deployer MCP: deployer_capabilities, read deployer://docs/mcp-agent.',
      'Async ops — poll deployer_operation_get. Commerce MCP is a different server.',
    ].join('\n');
  }
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.length <= INSTRUCTIONS_MAX) return raw;
  return `${raw.slice(0, INSTRUCTIONS_MAX)}\n\n…[full playbook: resource deployer://docs/mcp-agent]`;
}

module.exports = { loadServerInstructions };
