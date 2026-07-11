# Deployer MCP v1

HTTP MCP-сервер на том же домене, что и Deployer: `POST https://<хост>/mcp`.

## Документация для AI-агента

| Документ | Для кого | Содержание |
|----------|----------|------------|
| **[DEPLOYER-MCP-AGENT-RU.md](DEPLOYER-MCP-AGENT-RU.md)** | **Агент (обязательно)** | Playbook: сценарии, async poll, ошибки, примеры |
| [DEPLOYER-MCP-TOOLS-RU.md](DEPLOYER-MCP-TOOLS-RU.md) | Агент | Справочник 24 tools + JSON |
| Этот файл | Человек + агент | Ключи, env, проверка |
| [docs/skills/deployer-mcp-operator/SKILL.md](skills/deployer-mcp-operator/SKILL.md) | Cursor skill | Краткие правила для агента |

**В MCP resources:** `deployer://docs/mcp-agent` (playbook), `deployer://docs/mcp-tools` (справочник).

**Первый prompt агента:** `deployer_agent_onboarding` или `deployer_capabilities` + прочитать resource `mcp-agent`.

## Ключ доступа

1. Войти в Deployer (логин/пароль из `ADMIN_USER` / `ADMIN_PASSWORD`).
2. На главной странице первый блок — **MCP / AI**.
3. «Выпустить ключ» → скопировать `dep_mcp_live_…` **один раз**.
4. В Cursor (или другом MCP-клиенте) добавить сервер:

```json
{
  "mcpServers": {
    "deployer": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer dep_mcp_live_…"
      }
    }
  }
}
```

- **localhost** (`127.0.0.1:3000`) — Cursor на той же машине, что и Deployer.
- **LAN** (`192.168.0.2:3000`) — Cursor на другом ПК в сети (dev-стек: deployer-1 на порту 3000).
- Commerce и Deployer — **разные** MCP-серверы: Commerce управляет магазином, Deployer — контейнерами и шаблонами.

## Доступ

- MCP-ключ = **полный доступ** к Deployer API (deploy, lifecycle, шаблоны, volumes). **Без ролей** — в отличие от Commerce.
- Максимум **5** активных ключей на инстанс Deployer.
- В БД хранится HMAC-хеш от **`DEPLOYER_SECRET`**, plaintext показывается один раз при выпуске.
- Отзыв: **только UI** или `POST /api/v1/mcp/keys/:id/revoke` (web-сессия). Через MCP tools — **нельзя**.

## Auth

- Bearer: только `dep_mcp_live_…`
- Управление ключами: **только web-сессия** (логин в UI), не `x-api-key`.
- MCP `tools/call` — только Bearer MCP-ключа.

## Primitives

| Тип | Кол-во | Описание |
|-----|--------|----------|
| **Tools** | **24** | Deploy/lifecycle/шаблоны/тома (без управления MCP-ключами) |
| **Prompts** | **3** | `deployer_agent_onboarding`, `deployer_ops_briefing`, `deployer_deploy_flow` |
| **Resources** | **5** | playbook, tools ref, setup, agent-guide, api-integration |

Первый вызов агента: **`deployer_capabilities`**, затем resource **`deployer://docs/mcp-agent`**.

### Список tools

| Tool | Назначение |
|------|------------|
| `deployer_capabilities` | Версия, auth mode, key id |
| `deployer_health` | Health + Docker probe |
| `deployer_version_get` | Версия пакета |
| `deployer_capacity_get` | Ёмкость хоста |
| `deployer_substitution_tokens_get` | `GEN_*`, `DEPLOY_BASE_PATH` |
| `deployer_templates_list` / `_get` / `_save` / `_delete` | Шаблоны |
| `deployer_deploy` | Развёртывание (async operation) |
| `deployer_operation_get` | Poll операции |
| `deployer_containers_list` / `_get` / `_stats` / `_disk` / `_logs` | Контейнеры |
| `deployer_container_restart` / `_stop` / `_start` / `_delete` | Lifecycle |
| `deployer_volume_manifest` / `_import_session` / `_transfer` / `_sync` | Тома |

### Вне MCP

| Сценарий | Почему |
|----------|--------|
| `GET/POST /api/v1/mcp/keys` | Ключи — только web-сессия |
| `POST /api/login` | Браузерная сессия |
| `POST …/import-stream` | Поток tar (multipart/stream), не JSON tool |

## Ограничение tools на деплое

`DEPLOYER_MCP_TOOLS_DENY` — список имён tools через запятую. Запрещённые **не попадают** в `tools/list`; `tools/call` → `tool_disabled_by_policy`.

Пример:

```env
DEPLOYER_MCP_TOOLS_DENY=deployer_container_delete,deployer_template_delete,deployer_volume_transfer
```

Справочник имён — [DEPLOYER-MCP-TOOLS-RU.md](DEPLOYER-MCP-TOOLS-RU.md). У Commerce — **`COMMERCE_MCP_TOOLS_DENY`** (отдельный сервер).

## Нагрузка

`tools/call` через очередь: по умолчанию ≤4 параллельных handler-ов, до 16 в ожидании.

| Переменная | По умолчанию |
|------------|--------------|
| `DEPLOYER_MCP_MAX_CONCURRENT` | 4 |
| `DEPLOYER_MCP_MAX_QUEUED` | 16 |
| `DEPLOYER_MCP_QUEUE_TIMEOUT_MS` | 60000 |

## Env

| Переменная | Назначение |
|------------|------------|
| `DEPLOYER_PUBLIC_BASE_URL` | Публичный HTTPS URL Deployer (подсказки MCP/Cursor). Пусто — из запроса (Host + proxy) |
| `DEPLOYER_MCP_TOOLS_DENY` | Имена tools через запятую — скрыты из MCP и заблокированы на вызове |
| `DEPLOYER_SECRET` | Подпись сессии UI и HMAC hash MCP-ключей |

Ключи выпускаются в UI; без активного ключа `/mcp` отвечает 401.

Ключи хранятся в `{DEPLOY_BASE_PATH}/.deployer-state/mcp-keys.json` — отдельный volume не нужен.

**После правок `deployer/server/`** в dev-стеке перезапустите Deployer (Node не подхватывает код сам):

```bash
cd commerce
npm run docker:dev:restart-deployer
```

## Проверка

```bash
cd deployer
npm test -- test/mcp.test.js
```

## Связка Commerce + Deployer

В workspace два MCP в `.cursor/mcp.json`:

- **commerce** — витрина, биллинг, инстансы (`mcp_live_…` на `:3010`)
- **deployer** — Docker deploy на хосте (`dep_mcp_live_…` на `:3000`)

Commerce вызывает Deployer по HTTP (`x-api-key`); агент может дублировать операции через Deployer MCP для прямого доступа к шаблонам и контейнерам.
