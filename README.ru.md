# Deployer

[![CI](https://github.com/commercedeployer/deployer/actions/workflows/ci.yml/badge.svg)](https://github.com/commercedeployer/deployer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Dcommerce%20Deployer%20Source%201.0-blue.svg)](LICENSE)

Веб-приложение для развёртывания Docker-контейнеров по JSON-шаблонам: админка, REST API, async-операции. Управляет **только** контейнерами с managed-меткой (системные и чужие недоступны).

**English:** [README.md](README.md)

Установка на VPS (Traefik, registry, Deployer в одном стеке) — отдельный проект [Setup Server Stack](https://github.com/commercedeployer/setup-server-stack) (`setup-server-stack.sh`).

---

## Возможности

- Deploy по шаблону: `templateId` + `containerName` + `params`
- **Provision / deprovision / postStart** — шаги **в контейнере Deployer** (inline в JSON шаблона); утилиты — **`DEPLOYER_SOFTWARE`** (setup-server-stack `.env`, default `bash,curl`)
- Async API: `POST /api/deploy` → **202** + poll `GET /api/operations/:id`
- Редактор шаблонов в UI, импорт JSON
- Traefik-метки, multi-network, volumes под `DEPLOY_BASE_PATH`
- API key + сессия, rate limits, Helmet, OpenAPI `/api-docs`

---

## Идентификатор контейнера

**Идентификатор контейнера** — уникальное значение инстанса в Deployer. Одно значение на весь жизненный цикл: deploy, lifecycle, тома на диске, provision/deprovision.

В Docker это записано в поле **name** (в API Docker это называют «имя контейнера»). На **одном** хосте два контейнера с одним и тем же значением **нельзя** — Docker вернёт конфликт. Поэтому для нас это не «ярлык», а идентификатор.

Где встречается **одно и то же значение** (разные имена полей в коде и API):

| Место | Как называется в интерфейсе |
|-------|----------------------------|
| Тело deploy | `containerName` |
| Lifecycle (`/api/containers/...`) | `:id` в path |
| Label на контейнере | `deployer.containerName` |
| Шаблон | `{{CONTAINER_NAME}}` |
| Диск | `DEPLOY_BASE_PATH/<идентификатор>/` |

Дальше в документации — просто **идентификатор** (или **идентификатор контейнера**, если нужна ясность). **Идентификатор шаблона** — поле `templateId`, label `deployer.templateId`.

---

## Быстрый старт

### Локально (Node.js 18+)

```bash
cp .env.example .env
# ADMIN_PASSWORD, SESSION_SECRET, DEPLOY_BASE_PATH
# Опционально: DEPLOYER_PUBLIC_BASE_URL (MCP/Cursor; на stack — https://deployer.${DOMAIN})
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
| Provision / deprovision | [docs/PROVISION-v1-RU.md](docs/PROVISION-v1-RU.md), [docs/PROVISION-PITFALLS-v1-RU.md](docs/PROVISION-PITFALLS-v1-RU.md) |
| Provision tools (`DEPLOYER_SOFTWARE`) | [config/deployer-software.example.env](config/deployer-software.example.env), setup-server-stack `.env.example` |
| HTTP API | [docs/API-INTEGRATION.ru.md](docs/API-INTEGRATION.ru.md) |
| AI-агент | [docs/AGENT-GUIDE.ru.md](docs/AGENT-GUIDE.ru.md) |
| MCP (ключи в UI, env) | [docs/DEPLOYER-MCP-v1-RU.md](docs/DEPLOYER-MCP-v1-RU.md) |
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

**D-commerce Deployer Source License 1.0** — [LICENSE](LICENSE).

- **v2.0.0+** (это дерево): исходники открыты; можно использовать **внутри** своей системы для доставки **своего** продукта; перепродажа и заработок **через использование Deployer пользователями** (в том числе встроенного в оболочку или «бесплатного коннектора») — только с [коммерческой лицензией](docs/LICENSE-SUMMARY-RU.md).
- **v1.x и ранее:** [MIT](LICENSE-MIT.md).

См. [CHANGELOG.md](CHANGELOG.md). Кратко по-русски: [docs/LICENSE-SUMMARY-RU.md](docs/LICENSE-SUMMARY-RU.md).
