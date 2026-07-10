const fs = require('node:fs');
const path = require('node:path');

const DOC_ROOT = path.join(__dirname, '..', '..');

function readDocExcerpt(relativePath, maxChars = 48000) {
  const file = path.join(DOC_ROOT, relativePath);
  if (!fs.existsSync(file)) {
    return { text: `# Missing doc: ${relativePath}\n`, mimeType: 'text/markdown' };
  }
  const text = fs.readFileSync(file, 'utf8').slice(0, maxChars);
  return { text, mimeType: 'text/markdown' };
}

const RESOURCE_MAP = {
  'deployer://docs/mcp-agent': 'docs/DEPLOYER-MCP-AGENT-RU.md',
  'deployer://docs/mcp-tools': 'docs/DEPLOYER-MCP-TOOLS-RU.md',
  'deployer://docs/mcp': 'docs/DEPLOYER-MCP-v1-RU.md',
  'deployer://docs/agent-guide': 'docs/AGENT-GUIDE.ru.md',
  'deployer://docs/api-integration': 'docs/API-INTEGRATION.ru.md',
};

function createPromptRegistry() {
  return {
    prompts: [
      {
        name: 'deployer_ops_briefing',
        description: 'Ops checklist: read mcp-agent resource, then capacity + containers + pending operations',
        arguments: [],
      },
      {
        name: 'deployer_deploy_flow',
        description: 'Full deploy workflow: template → deploy → poll operation → verify logs',
        arguments: [],
      },
      {
        name: 'deployer_agent_onboarding',
        description: 'New session: capabilities, resources to read, Commerce vs Deployer split',
        arguments: [],
      },
    ],
    async getPrompt(name) {
      if (name === 'deployer_agent_onboarding') {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: [
                  'You are connected to Deployer MCP (Docker deploy admin).',
                  '',
                  '1. Call deployer_capabilities',
                  '2. Read MCP resources (in order):',
                  '   - deployer://docs/mcp-agent  (playbook — mandatory)',
                  '   - deployer://docs/mcp-tools (tool reference)',
                  '3. deployer_health + deployer_capacity_get + deployer_containers_list',
                  '',
                  'Commerce MCP is a DIFFERENT server (shop/billing). Use Deployer MCP for templates, deploy, container lifecycle.',
                  'Mutations return async operation — always poll deployer_operation_get.',
                ].join('\n'),
              },
            },
          ],
        };
      }
      if (name === 'deployer_ops_briefing') {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: [
                  'Deployer ops briefing — execute in order:',
                  '',
                  'READ: deployer://docs/mcp-agent (resource) if not loaded this session.',
                  '',
                  '1. deployer_capabilities — note version, keyId',
                  '2. deployer_health — Docker must be ok',
                  '3. deployer_capacity_get — free slots, disk headroom',
                  '4. deployer_containers_list — running/exited managed containers',
                  '5. For each non-running expected container: deployer_container_get + logs',
                  '',
                  'Report: capacity summary, container table (name, state, templateId), blockers.',
                  'Destructive actions only if user requested.',
                ].join('\n'),
              },
            },
          ],
        };
      }
      if (name === 'deployer_deploy_flow') {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: [
                  'Deployer deploy flow:',
                  '',
                  '1. deployer_templates_list → pick templateId',
                  '2. deployer_template_get { id } → read fields, build params (all required keys)',
                  '3. deployer_capacity_get — ensure container_limit not exceeded',
                  '4. deployer_deploy { templateId, containerName, params }',
                  '5. Loop deployer_operation_get { operationId } every 2s until succeeded|failed',
                  '6. deployer_container_get { id: containerName }',
                  '7. deployer_container_logs { id, tail: "100" } on failure or verify',
                  '',
                  'Provision templates (umami-pg): allow 5–15 min; watch operation.phase.',
                  'On operation_in_progress: poll existing op, do not parallel-deploy same containerName.',
                ].join('\n'),
              },
            },
          ],
        };
      }
      throw new Error(`Unknown prompt: ${name}`);
    },
  };
}

function createResourceRegistry() {
  const staticResources = [
    {
      uri: 'deployer://docs/mcp-agent',
      name: 'Deployer MCP agent playbook',
      description: 'START HERE — workflows, async ops, errors, Commerce vs Deployer (RU)',
      mimeType: 'text/markdown',
    },
    {
      uri: 'deployer://docs/mcp-tools',
      name: 'Deployer MCP tools reference',
      description: 'All 27 tools with JSON argument examples (RU)',
      mimeType: 'text/markdown',
    },
    {
      uri: 'deployer://docs/mcp',
      name: 'Deployer MCP setup',
      description: 'Keys, env, verification, human setup (RU)',
      mimeType: 'text/markdown',
    },
    {
      uri: 'deployer://docs/agent-guide',
      name: 'Deployer agent guide',
      description: 'Architecture: templates, provision, identity (RU)',
      mimeType: 'text/markdown',
    },
    {
      uri: 'deployer://docs/api-integration',
      name: 'Deployer API integration',
      description: 'HTTP contract: auth, async, delete semantics (RU)',
      mimeType: 'text/markdown',
    },
  ];

  return {
    staticResources,
    templates: [],
    async readResource(uri) {
      const rel = RESOURCE_MAP[uri];
      if (!rel) throw new Error(`Unknown resource: ${uri}`);
      return readDocExcerpt(rel);
    },
  };
}

module.exports = { createPromptRegistry, createResourceRegistry };
