# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2.1.3] — 2026-07-12

### Changed

- Container list: field `commerce` (Docker label key `commerce`, value = Commerce public base URL); replaces `commerceId` / `commerce.id`.

## [2.1.2] — 2026-07-12

### Added

- Deploy API: optional `labels` on `POST /api/deploy` — merged into Docker labels at `create` (Commerce sends `commerce.id`).
- Container list: `commerceId` field (value of `commerce.id` label) plus full `labels` map.

## [2.1.1] — 2026-07-12

### Fixed

- Vault substitution order: deploy params → provision outputs → vault → Deployer env (removed `hostContext` pre-vault bypass).
- Removed vault key denylist; any valid uppercase key allowed in UI.
- `umami-pg` bundled: `proxynet` literal, PG16 provision `GRANT … WITH SET OPTION`.

### Changed

- `secretsStore`: no in-memory cache; simpler file read/write.
- Template editor / MCP hints: correct substitution order; drop stale «server context» wording.

## [2.1.0] — 2026-07-12

### Added

- **Vault (Сейф):** shared secrets at `$DEPLOY_BASE_PATH/secrets.json`; templates use `{{KEY}}`; UI block on home (session-only API); MCP/API key cannot read values. Resolution order: deploy params → step context → vault → Deployer env.

## [Unreleased]

## [2.0.3] — 2026-07-12

### Fixed

- Template editor: provision step `env` survives save/reopen; merge from snapshot when DOM rows empty.
- `saveTemplate`: preserve `provision.env` when UI omits env block.

### Changed

- Remove `POSTGRES_ADMIN_URL` / `POSTGRES_HOST` from Deployer host env; Postgres admin URL belongs in template `provision.env` only.
- Bundled `umami-pg`: literal provision URL placeholder instead of `{{POSTGRES_ADMIN_URL}}`.

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
