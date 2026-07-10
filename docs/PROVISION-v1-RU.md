# Provision / Deprovision v1

**Статус:** runner, DELETE с `templateId` и multi-step — **в коде**. Боевые шаблоны с `provision`/`deprovision` — по мере добавления в каталог.  
**Связанные документы:** [PROVISION-PITFALLS-v1-RU.md](PROVISION-PITFALLS-v1-RU.md), [templates/README.ru.md](../templates/README.ru.md).

Deployer — **самостоятельное** приложение (OSS). Ниже — только его механизмы.

---

## Два поля в JSON-шаблоне

| Поле | Когда | Зачем |
|------|--------|--------|
| **`provision`** | **До** `docker create/start` (`POST /api/deploy`) | Подготовить окружение **в контейнере Deployer**, собрать переменные для `env` app-контейнера |
| **`postStart`** | **После** `docker start` (+ опционально `waitHealthy`) | Действие **в контейнере Deployer** при уже запущенном app-контейнере (сид админа в БД, …) |
| **`deprovision`** | **Только** при `DELETE …?removeData=true` | Убрать то, что создали при provision (роль в Postgres, DNS, …) |

Оба поля — **один формат шага**. Значение:

| Форма | Смысл |
|-------|--------|
| **один объект** `{ command, … }` | один шаг |
| **массив объектов** `[ { … }, { … } ]` | несколько шагов **по очереди** |

Квадратные скобки для одного шага **не обязательны**. Для двух и более — **обязательно** массив.

Нет поля — шаг не выполняется.

---

## Зачем

Перед app-контейнером **в контейнере Deployer** иногда нужно: создать роль в общем Postgres, вызвать API, подготовить каталог. Утилиты — **`DEPLOYER_SOFTWARE`** (setup-server-stack). После полного удаления подписки — симметрично убрать объекты вне Docker.

Это **не** Docker hook (`ENTRYPOINT`, `RUN`). Отдельная фаза Deployer до `docker create`.

Commerce **не имеет** SSH и **не знает** admin URL БД — только HTTP к Deployer на VPS продавца.

---

## Поток deploy (целиком)

```
POST /api/deploy { templateId, containerName, params }
        │
        ▼
┌─ provision (если есть в шаблоне) ─────────────────────┐
│  шаг 1 → шаг 2 → …  (только RAM: outputs + params)   │
│  любой шаг упал → provision_failed, СТОП             │
└──────────────────────────────────────────────────────┘
        │ все шаги ok
        ▼
   applyParams (ОДИН РАЗ) → env / volumes / ports контейнера
        │
        ▼
   pull → create → start → [waitHealthy]
        │
        ▼
┌─ postStart (если есть) ───────────────────────────────┐
│  шаг(и) в контейнере Deployer после healthy app        │
│  упал → post_start_failed, СТОП (контейнер уже есть) │
└──────────────────────────────────────────────────────┘
```

**Между шагами provision** шаблон контейнера **не трогается** — только накопление `outputs` в памяти и подстановка в `env`/`args` **следующего** шага.

**После всех шагов provision** — один `applyParams` → docker. Частично «заполненный» контейнер невозможен.

**`postStart`** — тот же формат шага, что `provision`, но **после** `start` (и `waitHealthy`, если включён). Пример: шаблон `umami-pg` — `server/umamiAdminSeed.js` выставляет логин/пароль админа в tenant-БД (образ Umami пока не читает `DEFAULT_ADMIN_*` при первом старте).

---

## Формат одного шага

```json
{
  "command": "bash",
  "args": ["-c", "…"],
  "env": {
    "PGADMIN_URL": "postgresql://admin:ПАРОЛЬ@127.0.0.1:5432/postgres",
    "TENANT": "{{CONTAINER_NAME}}"
  },
  "expect": ["DB_USER", "DB_PASSWORD"]
}
```

| Поле | Обязательно | Смысл |
|------|-------------|--------|
| `command` | да | Программа в **контейнере Deployer** (`bash`, `node`, `psql`, …). `node` — всегда; остальное — **`DEPLOYER_SOFTWARE`** (setup-server-stack). |
| `args` | нет | Аргументы. Команда и аргументы — **inline в JSON**, отдельные файлы на диске **не требуются**. |
| `env` | нет | Переменные процесса шага; `{{…}}` подставляет Deployer. |
| `expect` | нет | Имена ключей в JSON на **stdout** шага. Пустой массив или отсутствие поля — stdout не парсится, только exit 0. |

### Как шаг отдаёт переменные Deployer

1. Команда завершается с **exit 0**.
2. Если `expect` не пустой — из **stdout** парсится JSON (весь вывод или **последняя непустая строка**).
3. Ключи из `expect` **обязаны** присутствовать в JSON и быть непустыми.
4. Значения попадают в общий **`outputs`** (мешок в RAM на время deploy).
5. В шаблоне контейнера те же имена: `{{DB_USER}}`, `{{DB_PASSWORD}}`, …

Deployer **не угадывает** смысл полей — только **имена**, которые вы указали в `expect` и напечатали в JSON.

Пример последней строки stdout:

```json
{"DB_USER":"a1b2c3d4e5f6","DB_PASSWORD":"a1b2c3d4e5f6"}
```

Секреты в stderr и логи operation **не кладите** — при ошибке stderr может попасть в ответ API.

---

## Несколько шагов

```json
"provision": [
  {
    "command": "bash",
    "args": ["-c", "psql \"$PGADMIN_URL\" -v ON_ERROR_STOP=1 -c \"CREATE ROLE \\\"$TENANT\\\" LOGIN PASSWORD '$TENANT'\" -c \"CREATE DATABASE \\\"$TENANT\\\" OWNER \\\"$TENANT\\\"\""],
    "env": {
      "PGADMIN_URL": "postgresql://admin:ПАРОЛЬ@127.0.0.1:5432/postgres",
      "TENANT": "{{CONTAINER_NAME}}"
    },
    "expect": []
  },
  {
    "command": "bash",
    "args": ["-c", "printf '%s\\n' \"{\\\"DB_USER\\\":\\\"$TENANT\\\",\\\"DB_PASSWORD\\\":\\\"$TENANT\\\"}\""],
    "env": { "TENANT": "{{CONTAINER_NAME}}" },
    "expect": ["DB_USER", "DB_PASSWORD"]
  }
]
```

- Шаг 1: только действие в БД, `expect: []`.
- Шаг 2: печатает JSON для контейнера.
- Шаг 2 мог бы использовать `{{DB_USER}}` из шага 1, если шаг 1 вернул `expect`.

`outputs` после всех шагов = объединение `params` deploy + всех ключей из stdout.

---

## Пароли, логины, секреты — зона шаблона

Deployer **не** генерирует tenant-пароли, **не** хранит provision-store, **нет** «соли сервера».

| Источник | Где используется |
|----------|------------------|
| `{{CONTAINER_NAME}}` | идентификатор инстанса (= `containerName` в API) |
| `{{KEY}}` из `params` deploy | поля формы оффера Commerce |
| Значения в `env` шага provision/deprovision | admin URL Postgres, фиксированные креды — **в JSON шаблона на сервере** |
| `{{POSTGRES_ADMIN_URL}}` и др. | опционально из env процесса Deployer (docker-compose) |
| stdout provision (`expect`) | tenant-креды → `{{DB_USER}}` в env контейнера |

**Рекомендуемая модель для VPS продавца:** admin Postgres прописан в `env` блока шага в шаблоне (доступ к шаблонам = доступ к Deployer). Отдельное хранилище секретов не обязательно.

**Tenant-пароль** — логика inline-команды: часто `= CONTAINER_NAME`, или `+ {{SECRET}}` из `params`.

**Redeploy:** тот же идентификатор + те же `params` → идемпотентный SQL (`IF NOT EXISTS`).

**Deprovision:** `params` delete **не передаётся** — только `{{CONTAINER_NAME}}` и admin URL из шаблона. Пароль tenant при deprovision должен выводиться из того же правила, что при provision (обычно = идентификатор).

Подстановка в env/volumes контейнера — тот же **`applyParams`**, что без provision.

---

## Полный пример шаблона (inline, shared Postgres)

```json
{
  "id": "myready",
  "name": "MyReady",
  "image": "registry.example.com/myready:latest",
  "provision": {
    "command": "bash",
    "args": [
      "-c",
      "psql \"$PGADMIN_URL\" -v ON_ERROR_STOP=1 -c \"DO \\$\\$ BEGIN CREATE ROLE \\\"$TENANT\\\" LOGIN PASSWORD '$TENANT'; EXCEPTION WHEN duplicate_object THEN NULL; END \\$\\$;\" -c \"SELECT 'CREATE DATABASE \\\"$TENANT\\\" OWNER \\\"$TENANT\\\"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$TENANT')\\gexec\" && printf '%s\\n' \"{\\\"DB_USER\\\":\\\"$TENANT\\\",\\\"DB_PASSWORD\\\":\\\"$TENANT\\\"}\""
    ],
    "env": {
      "PGADMIN_URL": "postgresql://deploy_admin:СЕКРЕТ@127.0.0.1:5432/postgres",
      "TENANT": "{{CONTAINER_NAME}}"
    },
    "expect": ["DB_USER", "DB_PASSWORD"]
  },
  "deprovision": {
    "command": "bash",
    "args": [
      "-c",
      "psql \"$PGADMIN_URL\" -v ON_ERROR_STOP=1 -c \"DROP DATABASE IF EXISTS \\\"$TENANT\\\"\" -c \"DROP ROLE IF EXISTS \\\"$TENANT\\\"\""
    ],
    "env": {
      "PGADMIN_URL": "postgresql://deploy_admin:СЕКРЕТ@127.0.0.1:5432/postgres",
      "TENANT": "{{CONTAINER_NAME}}"
    },
    "expect": []
  },
  "env": [
    {
      "name": "DATABASE_URL",
      "value": "postgresql://{{DB_USER}}:{{DB_PASSWORD}}@127.0.0.1:5432/{{DB_USER}}"
    }
  ],
  "volumes": [
    { "host": "{{DEPLOY_BASE_PATH}}/{{CONTAINER_NAME}}/data", "container": "/app/data" }
  ]
}
```

`psql` и Postgres должны быть доступны **из контейнера Deployer** (в setup-server-stack — хост `postgres:5432`, env `POSTGRES_ADMIN_URL`; не `127.0.0.1` на Ubuntu). Пакет `psql` — ключ **`psql`** в `DEPLOYER_SOFTWARE`. При `ENABLE_POSTGRES=1` Postgres на том же VPS в compose.

---

## Удаление: `DELETE /api/containers/:id`

| Параметр | Default | Смысл |
|----------|---------|--------|
| `removeData` | `false` | `true` — purge диска + deprovision (если известен шаблон) |
| `templateId` | — | идентификатор шаблона для `deprovision`; **приоритет над** label |

| `removeData` | Контейнер | Шаблон | Действия |
|--------------|-----------|--------|----------|
| `false` | есть | — | снять контейнер; БД и тома **на месте** |
| `false` | нет | — | успех (идемпотентно) |
| `true` | есть | query или label | deprovision → снять → purge диска |
| `true` | есть/нет | нет | только purge диска |
| `true` | нет | query | deprovision → purge; **не** 404 |

**Provision при delete никогда.** Deprovision упал → диск всё равно чистится → `deprovisionWarning` в operation.

Приоритет `templateId`: **query** → label `deployer.templateId` → иначе deprovision не запускаем.

Commerce при окончательном удалении данных должен передавать `templateId` (см. `commerce/docs/technical/DEPLOYER-INTEGRATION-v1.md`).

---

## Label `deployer.templateId`

При каждом deploy: `deployer.containerName`, `deployer.templateId`, `managed-by=deployer`. Fallback для deprovision, если клиент не передал `templateId` в query.

---

## Где исполняется команда

В **окружении процесса Deployer** (контейнер Deployer в setup-server-stack, не Ubuntu VPS и не целевой app-контейнер). Таймаут шага: `PROVISION_TIMEOUT_MS` (default 120000 ms).

**Инструменты:** `node` — всегда (образ `node:20-alpine`). Остальное — env **`DEPLOYER_SOFTWARE`** (через setup-server-stack `.env`): по умолчанию `bash,curl`; для шаблонов с Postgres tenant — добавьте `psql`. См. `config/deployer-software.example.env`.

---

## Секреты в API

- Admin и tenant пароли **не** в `operation.result` и не в успешных ответах deploy.
- При ошибке provision возможен фрагмент stderr — не логируйте пароли в stderr.

---

## Универсальность

Deployer не знает Postgres / Mongo / DNS. Только `command` + `args` + `env` + JSON stdout. Логика — в шаблоне, inline.

---

## Резюме

| Тема | Правило |
|------|---------|
| Формат | `provision` / `deprovision` = объект **или** массив шагов |
| Переменные | JSON на stdout + `expect`; мешок `outputs` в RAM |
| Контейнер | `applyParams` **один раз** после всех шагов |
| Падение шага | deploy не стартует |
| Секреты | в шаблоне и inline-командах; отдельный vault не обязателен |
| Delete | deprovision только `removeData=true` + известен шаблон |
