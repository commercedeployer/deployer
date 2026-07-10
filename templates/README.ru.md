# Шаблоны контейнеров

JSON в `templates/`. Пустая папка → наполнение из bundled-набора (встроен в образ) при старте.

Полный контракт provision/deprovision: [docs/PROVISION-v1-RU.md](../docs/PROVISION-v1-RU.md).

## Идентификатор контейнера

**Не в JSON шаблона.** Задаётся при deploy (поле `containerName` в API). См. [README.ru.md](../README.ru.md).

Тома: `{{DEPLOY_BASE_PATH}}/{{CONTAINER_NAME}}/…`.

## Подстановки

| Плейсхолдер | Источник |
|-------------|----------|
| `{{CONTAINER_NAME}}` | идентификатор из deploy |
| `{{KEY}}` | `params` deploy или ключи из stdout provision (`expect`) |
| `{{DEPLOY_BASE_PATH}}` | каталог данных Deployer |
| `{{GEN_UUID}}` | один раз на deploy |

То же для `env`/`args` в блоках **`provision`** / **`deprovision`**. Неразрешённый `{{…}}` → ошибка.

## Provision / deprovision (кратко)

Команды выполняются **в контейнере Deployer** (не на Ubuntu VPS). Утилиты (`bash`, `psql`, …) — env **`DEPLOYER_SOFTWARE`** (setup-server-stack; default `bash,curl`; `node` всегда в образе). См. [config/deployer-software.example.env](../config/deployer-software.example.env).

Опциональные поля корня JSON:

| Поле | Когда |
|------|--------|
| `provision` | до `docker create` |
| `postStart` | после `healthy` контейнера (напр. `umami-pg` — смена пароля админа через `umamiAdminSeed.js`) |
| `deprovision` | при `DELETE ?removeData=true` |

Значение: **один шаг** (объект) или **цепочка** (массив объектов). Команды **inline** в `command`/`args` — отдельные `.sh` на диске не нужны.

Шаг с `expect: ["KEY", …]` должен напечатать в stdout JSON с этими ключами (обычно последней строкой). После всех шагов provision переменные подставляются в `env`/`volumes` контейнера через `{{KEY}}`.

Admin Postgres — в `env` шага в шаблоне (шаблоны доступны только админу Deployer).

## Формат

**id**, **name**, **image** обязательны. **containerName** в корне JSON не используется.

## Системные labels (Deployer)

При deploy Deployer сам вешает на контейнер (не из поля `labels` шаблона):

- `deployer.templateId` — какой шаблон использован;
- `deployer.containerName` — идентификатор из API.

Нужно для deprovision (fallback, если клиент не передал `templateId` в `DELETE`).
