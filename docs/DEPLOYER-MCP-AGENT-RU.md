# Deployer MCP — руководство для AI-агента

Документ для **агента** (Cursor, Claude, другой MCP-клиент), подключённого к Deployer MCP (`POST …/mcp`, Bearer `dep_mcp_live_…`).

Человеку (выпуск ключа, UI): [DEPLOYER-MCP-v1-RU.md](DEPLOYER-MCP-v1-RU.md).

---

## 1. Что ты управляешь

**Deployer** — сервис развёртывания Docker-контейнеров по JSON-шаблонам. Один инстанс = один хост с Docker.

| Через MCP ты можешь | Через Commerce MCP (другой сервер!) |
|---------------------|-------------------------------------|
| Шаблоны, deploy, lifecycle контейнеров | Магазин, биллинг, подписки, кабинет |
| Тома, capacity, логи | Инстансы **как продукт** (не прямой Docker) |
| Ключи MCP Deployer | Ключи MCP Commerce |

**Не путай:** задача «изменить шаблон на хосте» → **Deployer MCP**. «Подписка клиента, trial, письма» → **Commerce MCP**.

Deployer MCP-ключ = **полный API** (без ролей). Любой вызов tool = как админ в UI.

---

## 2. Первые 30 секунд (обязательно)

```
1. deployer_capabilities     → версия, keyId, access=full_api
2. deployer_health         → Docker доступен?
3. deployer_capacity_get   → слоты, CPU/RAM/disk
4. deployer_containers_list → что уже запущено
```

Перед **любой** мутацией проверь `deployer_capacity_get` и лимит `container_limit` в ответе `deployer_containers_list`.

**Resources (читай при старте сессии):**

| URI | Когда |
|-----|--------|
| `deployer://docs/mcp-agent` | Этот документ (playbook) |
| `deployer://docs/mcp-tools` | Справочник всех 24 tools с аргументами |
| `deployer://docs/mcp` | Выпуск ключа, env, проверка |
| `deployer://docs/api-integration` | HTTP-контракт (async, delete, auth) |
| `deployer://docs/agent-guide` | Архитектура Deployer (шаблоны, provision) |

**Prompts:** `deployer_ops_briefing`, `deployer_deploy_flow` — короткие чеклисты.

---

## 3. Асинхронные операции (критично)

Почти все **мутации** (deploy, start/stop/restart/delete, volume transfer/sync) возвращают **не готовый результат**, а объект `operation`:

```json
{
  "ok": true,
  "operation": {
    "operationId": "…",
    "kind": "deploy",
    "status": "queued",
    "phase": "",
    "message": ""
  }
}
```

### Алгоритм poll

```
deployer_deploy / deployer_container_restart / … 
  → взять operation.operationId
  → цикл каждые 2–3 с:
       deployer_operation_get { operationId }
       status == succeeded → готово, смотри result
       status == failed    → ошибка в error/message
       status == queued|running → ждать
  → таймаут 5–15 мин для deploy с provision
```

**Ошибка `operation_in_progress`:** на этот `containerName`/slot уже идёт операция. Сначала `deployer_operation_get` по `existingOperationId` из ответа или подожди и повтори.

**Legacy:** при `DEPLOYER_SYNC_LEGACY=1` deploy может вернуть сразу `{ container, params }` без operation — на dev-стеке по умолчанию **async**.

---

## 4. Идентификаторы

| Поле | Правило |
|------|---------|
| `containerName` | Уникальное Docker-имя при deploy; `[a-zA-Z0-9][a-zA-Z0-9_.-]*`, max 128 |
| `templateId` | id JSON-шаблона (`integration-smoke`, `umami-pg`, …) |
| `params` | Объект полей шаблона; все `{{KEY}}` из шаблона должны быть заполнены |
| `id` в lifecycle | Имя контейнера **или** Docker id (как в `deployer_containers_list`) |

В шаблонах: `{{CONTAINER_NAME}}`, `{{GEN_UUID}}`, … — см. `deployer_substitution_tokens_get`.

Данные на диске: `{DEPLOY_BASE_PATH}/{containerName}/…` (обычно `/opt/deploy-data`).

Labels на контейнере: `deployer.containerName`, `deployer.templateId`.

---

## 5. Сценарии → tools

### 5.1 Обзор стенда

| Шаг | Tool | Аргументы |
|-----|------|-----------|
| Версия / режим auth | `deployer_version_get` | `{}` |
| Docker + процесс | `deployer_health` | `{}` |
| Ёмкость | `deployer_capacity_get` | `{}` |
| Список контейнеров | `deployer_containers_list` | `{ "q": "", "limit": 20, "offset": 0 }` |
| Все контейнеры на хосте | `deployer_containers_list` | `{ "all": true }` |

### 5.2 Шаблоны

| Задача | Tool |
|--------|------|
| Список | `deployer_templates_list` |
| Полный JSON | `deployer_template_get` `{ "id": "…" }` |
| Создать/обновить | `deployer_template_save` `{ "template": { … } }` |
| Удалить | `deployer_template_delete` `{ "id": "…" }` **destructive** |
| Подстановки | `deployer_substitution_tokens_get` |

Перед `deployer_template_save`: прочитай текущий шаблон через `_get`, меняй минимальный diff.

### 5.3 Deploy

```
deployer_template_get { id }
  → собрать params из fields (обязательные без default)
deployer_deploy {
  templateId,
  containerName,
  params: { HOST_PORT: "8081", … }
}
  → poll deployer_operation_get
deployer_container_get { id: containerName }
deployer_container_logs { id: containerName, tail: "100" }
```

**Provision-шаблоны** (`umami-pg`, …): deploy дольше; в operation смотри `phase` (`provisioning`, `post_start`, …).

### 5.4 Lifecycle контейнера

| Действие | Tool | Примечание |
|----------|------|------------|
| Детали | `deployer_container_get` | `stats`, `inspect` опционально |
| CPU/RAM | `deployer_container_stats` | |
| Диск | `deployer_container_disk` | |
| Логи | `deployer_container_logs` | `tail`, `timestamps` |
| Старт | `deployer_container_start` | async |
| Стоп | `deployer_container_stop` | async, **destructive** |
| Рестарт | `deployer_container_restart` | async, **destructive** |
| Удалить | `deployer_container_delete` | см. §6 |

### 5.5 Тома (миграция / бэкап)

| Шаг | Tool |
|-----|------|
| Манифест файлов | `deployer_volume_manifest` `{ containerName, detail: true }` |
| Сессия импорта на приёмнике | `deployer_volume_import_session` |
| Перенос на другой Deployer | `deployer_volume_transfer` |
| Синхронизация (quiesced/hot) | `deployer_volume_sync` `{ mode: "quiesced" }` |

`import-stream` (заливка tar) — **только HTTP**, не MCP tool.

### 5.6 Ключи MCP

**Через MCP нельзя** — ни список, ни выпуск, ни отзыв. Это сделано намеренно: украденный MCP-ключ не должен плодить новые ключи и не должен отзывать чужие.

Ключи — **только в UI Deployer** (блок **MCP / AI** на главной) или REST `GET/POST /api/v1/mcp/keys` под **web-сессией** (после логина в браузере).

---

## 6. Опасные операции

Помечены `destructiveHint` в `tools/list`. **Спрашивай подтверждение**, если пользователь не просил явно:

| Tool | Риск |
|------|------|
| `deployer_deploy` | Новый контейнер, занимает слот |
| `deployer_template_delete` | Удаление шаблона |
| `deployer_container_delete` | См. `removeData` |
| `deployer_container_stop/restart` | Downtime |
| `deployer_volume_transfer/sync` | Перезапись данных на peer |

### Delete container

```json
{
  "id": "my-container",
  "removeData": false,
  "templateId": "umami-pg"
}
```

| removeData | Эффект |
|------------|--------|
| `false` | Только контейнер; данные на диске остаются |
| `true` | + удаление каталогов под DEPLOY_BASE_PATH; при `templateId` — deprovision из шаблона |

Если `removeData=true` без `templateId` и без label — удалятся только файлы на диске, deprovision не вызовется.

---

## 7. Ошибки (как читать)

| Симптом | Значение | Действие |
|---------|----------|----------|
| `Template not found` | Неверный templateId | `deployer_templates_list` |
| `Container not found` | Нет контейнера / неверный id | `deployer_containers_list` |
| `operation_not_found` | Старый operationId или рестарт Deployer | заново запусти операцию |
| `operation_in_progress` | Слот занят | poll или подожди |
| `mcp_server_busy` / 503 | Очередь MCP переполнена | retry через 2–5 с |
| `mcp_rate_limited` / 429 | Лимит запросов | retry |
| `mcp_key_limit` | 5 ключей в UI | отзови лишний в блоке MCP / AI |
| `Invalid params` / placeholder | Не хватает поля в params | `deployer_template_get` → fields |
| HTTP 401 | Ключ отозван / неверный | новый ключ в UI |

Ответ tool при бизнес-ошибке: `isError: true` в MCP, текст в `content[0].text` — **парси JSON** внутри.

---

## 8. Примеры вызовов

### Deploy integration-smoke

```json
// deployer_deploy
{
  "templateId": "integration-smoke",
  "containerName": "agent-smoke-01",
  "params": { "HOST_PORT": "18081" }
}
```

### Список с поиском

```json
// deployer_containers_list
{ "q": "umami", "limit": 10, "offset": 0 }
```

### Логи с таймстемпами

```json
// deployer_container_logs
{ "id": "my-container", "tail": "200", "timestamps": true }
```

### Inspect + stats

```json
// deployer_container_get
{ "id": "my-container", "stats": true, "inspect": false }
```

---

## 9. Commerce + Deployer в одном workspace

Типичный `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "commerce": { "url": "http://HOST:3010/mcp", "headers": { "Authorization": "Bearer mcp_live_…" } },
    "deployer": { "url": "http://HOST:3000/mcp", "headers": { "Authorization": "Bearer dep_mcp_live_…" } }
  }
}
```

| Задача пользователя | MCP |
|---------------------|-----|
| «Подписка, trial, письмо» | commerce |
| «Поднять/убить контейнер на хосте» | deployer |
| «Инстанс клиента в кабинете» | commerce (`commerce_instance_*`) |
| «Правка JSON шаблона deploy» | deployer |
| «Почему deploy упал» | deployer logs + operation; commerce reconcile — если связка через продукт |

Commerce ходит в Deployer по `x-api-key` (сервер-сервер). Агент может напрямую через Deployer MCP — быстрее для отладки шаблонов.

---

## 10. Чеклист завершения задачи

- [ ] `deployer_capabilities` в начале сессии
- [ ] После deploy/lifecycle — poll до `succeeded` или явный `failed`
- [ ] Проверка: `deployer_container_get` или `deployer_container_logs`
- [ ] Destructive — было явное согласие пользователя
- [ ] Не трогал Commerce, если задача только про Docker/шаблоны
- [ ] Краткий отчёт: containerName, templateId, статус, ссылка на логи при ошибке

---

## 11. Проверка стенда (для человека / CI)

```bash
cd deployer
npm run invoke:mcp-live    # все tools + prompts + resources
npm test -- test/mcp.test.js
```

---

## 12. Env (кратко)

| Переменная | Зачем агенту |
|------------|--------------|
| `DEPLOYER_PUBLIC_BASE_URL` | Канонический URL Deployer (если Host из запроса неверный) |
| `DEPLOYER_MCP_TOOLS_DENY` | Denylist tools на деплое (имена через запятую) |
| `DEPLOYER_SYNC_LEGACY=1` | Синхронный deploy (без operation) |
| `CONTAINER_LIMIT` | Лимит managed-контейнеров |
| `DEPLOY_BASE_PATH` | Где данные на хосте |

Полный список: [DEPLOYER-MCP-v1-RU.md](DEPLOYER-MCP-v1-RU.md).
