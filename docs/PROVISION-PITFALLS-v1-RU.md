# Provision v1 — подводные камни и обходы

**Статус:** в коде (runner, DELETE, multi-step).  
**Базовый документ:** [PROVISION-v1-RU.md](PROVISION-v1-RU.md).

Только механика Deployer.

---

## 1. Повторный deploy — объект уже есть

**Риск:** `CREATE USER` падает при том же идентификаторе контейнера.

**Обход:** идемпотентный скрипт в шаблоне; при redeploy те же `params` и тот же способ вычисления пароля (см. п. 13).

---

## 2. Provision ok, deploy упал

**Риск:** роль в БД есть, контейнера нет.

**Обход:** v1 без автоматического отката. Следующий deploy — идемпотентный provision. В operation: `provision ok, deploy failed`.

---

## 3. Delete без deprovision

**Риск:** `removeData=false` — контейнер снят, учётка в Postgres осталась.

**Обход:** ожидаемо. `deprovision` **только** при `removeData=true`. Не путать два режима delete.

**Риск:** контейнер уже снят, нужен purge Postgres — без `templateId` в query deprovision не запустится.

**Обход:** `DELETE …?removeData=true&templateId=…` (query важнее label). Без `templateId` и без контейнера — только диск, Postgres вручную или повторный delete с `templateId`.

---

## 4. Где хранятся пароли

**Риск:** утечка через API или логи.

**Обход:** admin — env Deployer; tenant — env контейнера после deploy. API и логи operation — без паролей.

---

## 5. Несколько нод Deployer, один Postgres

**Риск:** deploy на разных нодах, одна БД — гонки при provision.

**Обход:** уникальный идентификатор контейнера; идемпотентный provision в шаблоне.

---

## 6. Failover томов и Postgres

**Риск:** том переехал, БД общая — ок; redeploy с тем же идентификатором контейнера должен подключить тома по пути.

**Обход:** идемпотентный скрипт; пароль из идентификатора и/или `params`, не случайный на каждый deploy.

---

## 7. Сеть: Deployer → Postgres

**Риск:** в шаблоне `127.0.0.1:5432`, а Postgres только в Docker-сети compose.

**Обход:** в setup-server-stack Deployer и Postgres в одной сети — хост **`postgres`**. Admin URL — **`{{POSTGRES_ADMIN_URL}}`** в шаблоне, значение в **Сейфе** Deployer (не литерал в JSON).

---

## 8. Нет `bash` / `psql` / `jq` в контейнере Deployer

**Риск:** `command not found` в provision/deprovision.

**Обход:** `node` всегда есть (базовый образ). Остальное — **`DEPLOYER_SOFTWARE`** в `.env` setup-server-stack (или env контейнера): список через запятую, по умолчанию `bash,curl`. Для Postgres tenant (`umami-pg`) добавьте `psql`. Перезапуск контейнера Deployer доустанавливает пакеты в Alpine.

---

## 9. Произвольный код в шаблоне

**Риск:** provision = произвольный `spawn` **в контейнере Deployer** (доверенные шаблоны).

**Обход:** доверенные шаблоны; редактирование — только админ Deployer; секреты не в логах.

---

## 10. Таймаут

**Риск:** зависший процесс.

**Обход:** `PROVISION_TIMEOUT_MS`, kill, failed.

---

## 11. Несколько шагов

**Риск:** шаг 2 упал после шага 1.

**Обход:** массив шагов, merge outputs, без auto-rollback v1.

---

## 12. `expect` и `{{...}}` в env

**Риск:** опечатка → `Missing param`.

**Обход:** outputs мержатся в контекст до `applyParams`. Позже — валидация шаблона в UI.

---

## 13. Смена `params` при redeploy

**Риск:** клиент сменил поле вроде `SECRET` в `params` — скрипт выдал другой пароль, Postgres со старым паролем.

**Обход:** те же `params`, что при первом deploy (Commerce хранит для redeploy); в UI/шаблоне предупреждение «смена поля = потеря доступа к БД». Логику пароля задаёт скрипт шаблона, не Deployer.

---

## 14. Секрет в JSON шаблона на сервере

**Риск:** один и тот же захардкоженный секрет для всех инстансов шаблона на этом Deployer.

**Обход:** осознанный выбор архитектора; для изоляции — `params`, **Сейф** (`{{KEY}}`) или разные шаблоны.

---

## 22. Сейф (Vault)

**Риск:** `{{API_KEY}}` или `{{DEPLOYER_SECRET}}` в шаблоне подставятся из env контейнера Deployer (последний шаг) → утечка в контейнер клиента.

**Обход:** не использовать имена env самого Deployer в шаблонах клиентских приложений; инфра-секреты — через сейф.

**Риск:** сейф пуст, env не задан — deploy падает на unresolved `{{POSTGRES_ADMIN_URL}}`.

**Обход:** заполнить сейф (UI или `secrets.json`) или задать env контейнера Deployer с тем же именем ключа.

**Риск:** MCP сохранит литерал пароля в JSON шаблона.

**Обход:** в шаблоне только `{{POSTGRES_ADMIN_URL}}`; значение — в сейфе. API сейфа — только web-сессия (не MCP, не x-api-key).

**Порядок подстановки:** params deploy → outputs provision → сейф → env Deployer.

---

## 15. Фазы operation

**Риск:** клиент API не знает `provisioning` / `deprovisioning`.

**Обход:** документировать в openapi: `provisioning`, `provision_failed`, `deprovisioning`, `deprovision_failed`.

---

## 16. Ответ API

**Риск:** пароли в `operation.result`.

**Обход:** whitelist полей; секреты provision не в JSON ответа.

---

## 17. Смена шаблона, тот же идентификатор контейнера

**Риск:** другой provision, старая схема в БД.

**Обход:** v1 — совместимый deprovision вручную или новый идентификатор контейнера. Документировать для авторов шаблонов.

---

## 18. `removeData=false` vs `true`

**Риск:** случайно вызвать `deprovision` при снятии контейнера без удаления данных.

**Обход:** жёстко в коде: `deprovision` только если `removeData=true`.

**Риск:** `removeData=true`, контейнера нет — клиент ждёт 404.

**Обход:** **202** и удаление данных по идентификатору; deprovision — если передан `templateId` (или label, пока контейнер был).

---

## 19. Старая версия Deployer

**Риск:** шаблон с `provision`, runner ещё нет.

**Обход:** `features.provision` в `/api/capacity` или health.

---

## 20. Windows vs Linux

**Риск:** PATH, кавычки.

**Обход:** официально Ubuntu; остальное best effort.

---

## 21. Параллельные deploy

**Риск:** гонки в БД.

**Обход:** уникальный идентификатор контейнера; лимит `MAX_CONCURRENT_OPERATIONS`.

---

## Сводка

| Данные | Где |
|--------|-----|
| Admin URL | **Сейф** Deployer (`secrets.json`) или env Deployer |
| Tenant-пароль | env контейнера; логика в скрипте шаблона + `params` |
| В HTTP API | статус, без паролей |
| Идентификатор контейнера | поле `containerName`, label `deployer.containerName` |

---

## Открытые вопросы (реализация)

1. ~~Пароль при redeploy~~ — **решено:** не механизм Deployer; идентификатор + `params` + скрипт шаблона.
2. ~~Откуда `templateId` при delete~~ — **решено:** query → label → без deprovision.
3. ~~Delete без контейнера~~ — **решено:** не 404 при `removeData=true`; purge по идентификатору.
