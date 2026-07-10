# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2.0.0] — 2026-07-10

### Added

- HTTP **MCP** server (`POST /mcp`): 24 tools, 3 prompts, 5 resources for AI agents; MCP API keys in UI (`dep_mcp_live_…`); `DEPLOYER_MCP_TOOLS_DENY` policy denylist; live smoke `npm run invoke:mcp-live`.
- **Provision / deprovision / postStart** in template JSON; `provisionRunner` inside Deployer container; `DEPLOYER_SOFTWARE` for optional Alpine tools (`bash,curl`, `psql`, …).
- **Volume APIs:** manifest, import-session, import-stream, sync, transfer — cross-node data paths for Commerce placement/failover.
- **`GET /api/capacity`** — slot limits, queue, Docker probe for placement.
- Deploy service refactor (`deployService.js`, shared HTTP + MCP).
- Bundled template **`umami-pg`** with admin seed; `templates-bundled/` layout.
- Docker image **entrypoint** (`docker/entrypoint.sh`) for runtime software install.
- Docs: MCP agent playbook, tools reference, provision guides; Cursor skill `docs/skills/deployer-mcp-operator/`.

### Changed

- Templates: `templates-default/` merged into `templates/` + `templates-bundled/`; restore/sync scripts updated.
- UI: MCP keys block, template editor and locales updates.
- OpenAPI and integration docs aligned with capacity, volumes, MCP env (`DEPLOYER_PUBLIC_BASE_URL`, session-based MCP key hashing).
- Security audit docs refreshed.

### Fixed

- Integration and template tests updated for new template layout and deploy identity.

## [1.2.0] — earlier

See git tags `v1.2.0` … `v1.2.2`.
