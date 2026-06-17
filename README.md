# Deployer

[![CI](https://github.com/commercedeployer/deployer/actions/workflows/ci.yml/badge.svg)](https://github.com/commercedeployer/deployer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Web app for deploying Docker containers from JSON templates: admin UI, REST API, async operations. Manages **only** containers with the managed label (system and foreign containers are invisible).

**Русский:** [README.ru.md](README.ru.md)

VPS install (Traefik, registry, Deployer in one stack) — separate project [Setup Server Stack](https://github.com/commercedeployer/setup-server-stack) (`setup-server-stack.sh`).

---

## Features

- Deploy by template: `templateId` + `containerName` + `params`
- Async API: `POST /api/deploy` → **202** + poll `GET /api/operations/:id`
- Template editor in UI, JSON import
- Traefik labels, multi-network, volumes under `DEPLOY_BASE_PATH`
- API key + session, rate limits, Helmet, OpenAPI `/api-docs`

---

## Quick start

### Local (Node.js 18+)

```bash
cp .env.example .env
# ADMIN_PASSWORD, SESSION_SECRET, DEPLOY_BASE_PATH
npm install
npm start
```

UI: **http://localhost:3000** (set `NODE_ENV=development` for HTTP without TLS).

### Docker (Linux)

```bash
docker build -t deployer:latest .
docker run -d --name deployer --user root -p 3000:3000 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD="strong-password" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e DEPLOY_BASE_PATH=/opt/deploy-data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/deployer/templates:/app/templates \
  -v /opt/deploy-data:/opt/deploy-data \
  deployer:latest
```

Published images (public, no `docker login` for pull):

| Registry | Image | Page |
|----------|--------|------|
| **Docker Hub** (default in stack docs) | `docker.io/commercedeployer/deployer:latest` | [hub.docker.com/r/commercedeployer/deployer](https://hub.docker.com/r/commercedeployer/deployer) |
| **GHCR** | `ghcr.io/commercedeployer/deployer:latest` | GitHub → Packages |

```bash
docker pull commercedeployer/deployer:latest
# or: docker pull ghcr.io/commercedeployer/deployer:latest
```

Pin a release tag (e.g. `:v1.2.0`) instead of `:latest` in production. Images are published under org `commercedeployer` on Docker Hub and GHCR.

### Windows + Docker Desktop

`DEPLOY_BASE_PATH` must be a path Docker can see (e.g. `C:/deploy-data`). Use `NODE_ENV=development` for HTTP sessions.

### docker compose

```bash
cp .env.example .env
docker compose up -d --build
```

---

## Templates

Bundled in `templates/`: demo tiers (`docker-demo-free`, `docker-demo-basic`, `docker-demo-pro`), `mariadb`, `wordpress`, smoke `integration-smoke`. Format — **[templates/README.md](templates/README.md)** ([RU](templates/README.ru.md)).

Custom templates: UI editor (**Import JSON**) or `POST /api/templates`.

---

## REST API

- OpenAPI: **`/api-docs`** (`server/openapi.json`, v1.1)
- Client integration: **[docs/API-INTEGRATION.md](docs/API-INTEGRATION.md)** ([RU](docs/API-INTEGRATION.ru.md))
- Legacy sync: `DEPLOYER_SYNC_LEGACY=1`

Environment variables: `.env.example`.

---

## Documentation

| Topic | Document |
|-------|----------|
| HTTP API for clients | [docs/API-INTEGRATION.md](docs/API-INTEGRATION.md) |
| AI agent guide | [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md) |
| Manual server deploy | [docs/MANUAL-DEPLOY.md](docs/MANUAL-DEPLOY.md) |
| Templates | [templates/README.md](templates/README.md) |
| DNS / Traefik | [DOMAINS-AND-DNS.md](DOMAINS-AND-DNS.md) |
| Security | [SECURITY.md](SECURITY.md), [SECURITY-AUDIT.md](SECURITY-AUDIT.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## Tests

```bash
npm test                  # unit (134+ tests)
npm run test:integration  # requires Docker on host
npm run test:ui           # Playwright smoke (server on :3000)
```

Full run: `npm run test:all`.

---

## Container images

CI publishes on tag `v*` to **Docker Hub** and **GHCR** — [.github/workflows/publish-image.yml](.github/workflows/publish-image.yml).

| Registry | Image | Notes |
|----------|--------|--------|
| Docker Hub | `docker.io/commercedeployer/deployer:latest` | Public; [hub.docker.com/r/commercedeployer/deployer](https://hub.docker.com/r/commercedeployer/deployer) |
| GHCR | `ghcr.io/commercedeployer/deployer:latest` | Public after package visibility in GitHub Packages |

```bash
docker pull commercedeployer/deployer:latest
docker run --rm commercedeployer/deployer:latest node -e "console.log('ok')"
```

Docker Hub CI needs secrets `DOCKERHUB_USERNAME` (`commercedeployer`) and `DOCKERHUB_TOKEN`. GHCR uses the built-in `GITHUB_TOKEN`.

---

## License

[MIT](LICENSE)
