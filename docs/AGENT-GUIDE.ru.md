# Инструкция для AI-агента (Deployer)

Deployer — OSS-приложение для deploy Docker по JSON-шаблонам. Клиенты вызывают HTTP API.

VPS с Traefik — **[Setup Server Stack](https://github.com/commercedeployer/setup-server-stack)**.

---

## Источник правды

1. **Код:** `server/`, `public/`, `templates/*.json`
2. **Тесты:** `test/*.test.js`, `test/integration/`
3. **API:** `server/openapi.json`, `docs/API-INTEGRATION.ru.md`
4. **Доки:** `README.ru.md`, `templates/README.ru.md`, `SECURITY-AUDIT.ru.md`

---

## Шаблоны по умолчанию

`docker-demo-*`, `integration-smoke`, `docker-getting-started`, **`umami-pg`** (provision + postStart), `mariadb`, `wordpress`.

---

## Идентификаторы

См. [README.ru.md](README.ru.md) — определение идентификатора контейнера (один раз).

Deploy: `containerName` + `templateId` + `params`. Async 202 + poll. Дубликат идентификатора → 409.

На каждый deploy: labels `deployer.containerName`, `deployer.templateId`.

Delete: `DELETE /api/containers/:id?removeData=&templateId=`. См. `docs/PROVISION-v1-RU.md`.

Provision/deprovision/postStart: шаг(и) в JSON шаблона, выполняются **в контейнере Deployer** (`spawn`), inline `command`/`args`, stdout JSON + `expect`. Утилиты — env **`DEPLOYER_SOFTWARE`** (setup-server-stack, default `bash,curl`; `node` всегда в образе). `postStart` — после `start` (+ `waitHealthy`). Пароли — в шаблоне, не в ядре Deployer. Bundled `umami-pg`: `server/umamiAdminSeed.js` + `psql` в `DEPLOYER_SOFTWARE` + поля оффера `DEFAULT_ADMIN_*`.

---

## Тесты

`npm test`, `npm run test:integration`, `npm run test:ui`.

**MCP:** см. [DEPLOYER-MCP-AGENT-RU.md](DEPLOYER-MCP-AGENT-RU.md) (playbook), [DEPLOYER-MCP-v1-RU.md](DEPLOYER-MCP-v1-RU.md) (`DEPLOYER_PUBLIC_BASE_URL`, `DEPLOYER_MCP_TOOLS_DENY`, ключи через UI, hash = `SESSION_SECRET`). Skill: `docs/skills/deployer-mcp-operator/SKILL.md`.
