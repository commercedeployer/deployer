---
name: deployer-mcp-operator
description: Operate Deployer via MCP — deploy, templates, containers, volumes. Use when connected to Deployer MCP (dep_mcp_live_ key on /mcp).
---

# Deployer MCP Operator

## Prerequisites

- MCP URL: `http(s)://<host>:3000/mcp` (dev pool: `:3000`, `:3001`, `:3002` — `DEPLOYER_PUBLIC_BASE_URL` per node in `docker-compose.dev.yml`)
- Bearer key `dep_mcp_live_…` from Deployer UI → **MCP / AI** (first block on home page)
- **Full API access** — no roles (unlike Commerce MCP). Deploy operator may shrink the tool set via **`DEPLOYER_MCP_TOOLS_DENY`** in env.

## First step (mandatory)

1. `deployer_capabilities`
2. `deployer_health` + `deployer_capacity_get`
3. `deployer_containers_list`

Read MCP resource **`deployer://docs/mcp-agent`** for full playbook.

## Core rules

- **Async:** deploy/lifecycle → `operation` → poll `deployer_operation_get` every 2–3s until `succeeded`/`failed`.
- **Identity:** deploy needs `templateId` + `containerName` + `params` (all template placeholders filled).
- **Destructive** tools (delete, deploy, template delete, volume sync) — only when user explicitly asked.
- **Do not use Commerce MCP** for Docker/template work — use Deployer MCP.
- On `operation_in_progress` — poll existing op or wait; don't spam parallel deploys on same containerName.

## Key tools by task

| Task | Tools |
|------|-------|
| Overview | `deployer_capacity_get`, `deployer_containers_list`, `deployer_health` |
| Templates | `deployer_templates_list`, `deployer_template_get`, `deployer_template_save` |
| Deploy | `deployer_deploy` → `deployer_operation_get` → `deployer_container_logs` |
| Lifecycle | `deployer_container_start/stop/restart/delete` + poll |
| Debug | `deployer_container_logs`, `deployer_container_get`, `deployer_container_stats` |
| Volumes | `deployer_volume_manifest`, `deployer_volume_transfer`, `deployer_volume_sync` |

**MCP-ключи** — только UI Deployer (блок MCP / AI), не через MCP tools.

## Docs (MCP resources)

| URI | Content |
|-----|---------|
| `deployer://docs/mcp-agent` | Agent playbook (start here) |
| `deployer://docs/mcp-tools` | All 24 tools + JSON examples |
| `deployer://docs/mcp` | Human setup, env, verification |
| `deployer://docs/api-integration` | HTTP contract |

Files: `deployer/docs/DEPLOYER-MCP-AGENT-RU.md`, `DEPLOYER-MCP-TOOLS-RU.md`, `DEPLOYER-MCP-v1-RU.md`.

## Verify

```bash
cd deployer && npm run invoke:mcp-live
```
