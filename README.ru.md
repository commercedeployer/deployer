# Deployer

[![CI](https://github.com/commercedeployer/deployer/actions/workflows/ci.yml/badge.svg)](https://github.com/commercedeployer/deployer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Веб-приложение для развёртывания Docker-контейнеров по JSON-шаблонам: админка, REST API, async-операции. Управляет **только** контейнерами с managed-меткой (системные и чужие недоступны).

**English:** [README.md](README.md)

Установка на VPS (Traefik, registry, Deployer в одном стеке) — отдельный проект [Setup Server Stack](https://github.com/commercedeployer/setup-server-stack) (`setup-server-stack.sh`).

---

## Возможности

- Deploy по шаблону: `templateId` + `containerName` + `params`
- Async API: `POST /api/deploy` → **202** + poll `GET /api/operations/:id`
- Редактор шаблонов в UI, импорт JSON
- Traefik-метки, multi-network, volumes под `DEPLOY_BASE_PATH`
- API key + сессия, rate limits, Helmet, OpenAPI `/api-docs`

---

## Быстрый старт

### Локально (Node.js 18+)

```bash
cp .env.example .env
# ADMIN_PASSWORD, SESSION_SECRET, DEPLOY_BASE_PATH
npm install
npm start
```

Интерфейс: **http://localhost:3000** (для HTTP без TLS задайте `NODE_ENV=development`).

### Docker (Linux)

```bash
docker build -t deployer:latest .
docker run -d --name deployer --user root -p 3000:3000 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD="надёжный_пароль" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e DEPLOY_BASE_PATH=/opt/deploy-data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/deployer/templates:/app/templates \
  -v /opt/deploy-data:/opt/deploy-data \
  deployer:latest
```

Опубликованные образы (public, pull без `docker login`):

| Registry | Образ | Страница |
|----------|--------|----------|
| **Docker Hub** (по умолчанию в stack) | `docker.io/commercedeployer/deployer:latest` | [hub.docker.com/r/commercedeployer/deployer](https://hub.docker.com/r/commercedeployer/deployer) |
| **GHCR** | `ghcr.io/commercedeployer/deployer:latest` | GitHub → Packages |

```bash
docker pull commercedeployer/deployer:latest
```

Образы публикуются под org `commercedeployer` на Docker Hub и GHCR.

### docker compose

```bash
cp .env.example .env
docker compose up -d --build
```

---

## Шаблоны

Каталог `templates/`: demo tiers, `mariadb`, `wordpress`, smoke `integration-smoke`. Формат — **[templates/README.ru.md](templates/README.ru.md)**.

---

## REST API

- OpenAPI: **`/api-docs`**
- Интеграция: **[docs/API-INTEGRATION.ru.md](docs/API-INTEGRATION.ru.md)**
- Legacy sync: `DEPLOYER_SYNC_LEGACY=1`

---

## Документация

| Тема | Файл |
|------|------|
| HTTP API | [docs/API-INTEGRATION.ru.md](docs/API-INTEGRATION.ru.md) |
| AI-агент | [docs/AGENT-GUIDE.ru.md](docs/AGENT-GUIDE.ru.md) |
| Ручной деплой | [docs/MANUAL-DEPLOY.ru.md](docs/MANUAL-DEPLOY.ru.md) |
| Шаблоны | [templates/README.ru.md](templates/README.ru.md) |
| DNS / Traefik | [DOMAINS-AND-DNS.ru.md](DOMAINS-AND-DNS.ru.md) |
| Безопасность | [SECURITY.ru.md](SECURITY.ru.md), [SECURITY-AUDIT.ru.md](SECURITY-AUDIT.ru.md) |
| Участие | [CONTRIBUTING.ru.md](CONTRIBUTING.ru.md) |

---

## Тесты

```bash
npm test
npm run test:integration
npm run test:ui
```

---

## Образы

CI публикует по тегу `v*` в **Docker Hub** и **GHCR** — [.github/workflows/publish-image.yml](.github/workflows/publish-image.yml).

| Registry | Образ |
|----------|--------|
| Docker Hub | `docker.io/commercedeployer/deployer:latest` |
| GHCR | `ghcr.io/commercedeployer/deployer:latest` |

```bash
docker pull commercedeployer/deployer:latest
```

Секреты Docker Hub: `DOCKERHUB_USERNAME` (`commercedeployer`), `DOCKERHUB_TOKEN`. GHCR — встроенный `GITHUB_TOKEN`.

---

## Лицензия

[MIT](LICENSE)
