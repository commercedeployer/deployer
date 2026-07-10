# HTTP API — интеграция клиентов (v1)

Deployer — standalone-сервис. Спецификация: **`/api-docs`**.

## Аутентификация

| Режим | Env | Как |
|-------|-----|-----|
| UI | `ADMIN_USER` / `ADMIN_PASSWORD` | cookie после `POST /api/login` |
| API | `API_KEY` | `X-API-Key` |
| Оба | `DEPLOYER_AUTH_MODE=dual` | сессия или ключ |

Для server-to-server — **только API key**.

## Deploy (async)

`POST /api/deploy` → **202** + poll `GET /api/operations/:id`.

Тело: `templateId`, `containerName`, `params` (см. [README.ru.md](../README.ru.md) — идентификатор контейнера).

- `{{CONTAINER_NAME}}` в шаблоне — идентификатор из deploy.
- Дубликат активного идентификатора → **409**.
- Legacy: `DEPLOYER_SYNC_LEGACY=1` → **200**.

## Lifecycle

Async **202**: list, logs, start/stop/restart, delete.

### Delete

`DELETE /api/containers/:id?removeData=false&templateId=…`

| Параметр | Default | Смысл |
|----------|---------|--------|
| `removeData` | `false` | `true` — удалить данные под `DEPLOY_BASE_PATH/<идентификатор>/` и при наличии шаблона — `deprovision` |
| `templateId` | — | идентификатор шаблона для `deprovision`; **приоритет над** label `deployer.templateId` |

| `removeData` | Контейнер | Как определили шаблон | Результат |
|--------------|-----------|----------------------|-----------|
| `false` | есть | — | снять контейнер, тома и Postgres на месте |
| `false` | нет | — | **успех** (идемпотентно) |
| `true` | есть | query или label | deprovision (если в шаблоне) → снять → удалить данные на диске |
| `true` | есть/нет | **ни query, ни label** | **только** удаление данных на диске; deprovision **нет** |
| `true` | нет | query | deprovision (если в шаблоне) → удалить данные; **не** 404 |

Подробно: [PROVISION-v1-RU.md](PROVISION-v1-RU.md).

## Managed-контейнеры

`MANAGED_LABEL` / `MANAGED_LABEL_VALUE` (default `managed-by=deployer`).

При deploy Deployer всегда добавляет:

- `deployer.containerName` — идентификатор;
- `deployer.templateId` — идентификатор шаблона.

Provision/deprovision: идентификатор + `params` + скрипт шаблона — см. [PROVISION-v1-RU.md](PROVISION-v1-RU.md).

## Шаблоны

`templates/README.ru.md`. Все `{{KEY}}` должны быть в `params`.

## Health

`GET /api/health` без auth.
