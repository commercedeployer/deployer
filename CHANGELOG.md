# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [2.0.0] — 2026-07-10

### Changed

- **License:** MIT replaced by [D-commerce Deployer Source License 1.0](LICENSE). Releases **before 2.0.0** remain under [MIT](LICENSE-MIT.md).
- Version **2.0.0** marks the license change; feature history since 1.x is included in this release line.

### Added

- HTTP **MCP** server (`/mcp`): 24 tools, prompts, resources for AI agents; MCP keys in UI; `DEPLOYER_MCP_TOOLS_DENY`.
- **Provision / deprovision / postStart** in templates; `DEPLOYER_SOFTWARE` for tools inside the Deployer container.
- **Volume** manifest, import, sync, transfer APIs for multi-node failover.
- **`GET /api/capacity`** for placement and queue visibility.
- Russian license summary: [docs/LICENSE-SUMMARY-RU.md](docs/LICENSE-SUMMARY-RU.md).

## [1.2.0] and earlier

Licensed under MIT. See [LICENSE-MIT.md](LICENSE-MIT.md) and git tags `v1.*`.
