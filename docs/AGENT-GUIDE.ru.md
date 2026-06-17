# Инструкция для AI-агента (Deployer)

**English:** [AGENT-GUIDE.md](AGENT-GUIDE.md)

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

`docker-demo-*`, `integration-smoke`, `mariadb`, `wordpress`.

---

## Identity

`containerName` + `templateId` + `params`. Async 202 + poll. Дубликат → 409.

---

## Тесты

`npm test`, `npm run test:integration`, `npm run test:ui`.
