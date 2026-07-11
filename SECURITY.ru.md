# Безопасность Deployer

**English:** [SECURITY.md](SECURITY.md)

Пути — относительно **корня проекта**.

## Реализованные меры

- **Аутентификация**: один пользователь из env, bcrypt, сессия (httpOnly, secure в production, `sameSite=strict`).
- **API-ключ**: опциональный `API_KEY`, заголовок `X-API-Key`, constant-time сравнение.
- **Production**: без заданного `DEPLOYER_SECRET` приложение не стартует.
- **Заголовки**: Helmet. Лимит тела 256 KB.
- **Rate limit**: логин, deploy, шаблоны.
- **Пути томов**: только под `DEPLOY_BASE_PATH`.
- **Удаление данных**: `removeData=true` — только каталоги под `DEPLOY_BASE_PATH`.
- **Только свои контейнеры**: метка `MANAGED_LABEL` / `MANAGED_LABEL_VALUE`.
- **Привилегии контейнеров**: см. `BLOCKED_HOST_KEYS` в `server/dockerSpec.js`.

## Рекомендации

- **Сеть**: HTTPS reverse proxy, firewall/VPN.
- **API_KEY**: в секретах, отдельный ключ на prod.
- **Шаблоны**: пути томов под `DEPLOY_BASE_PATH`.
- **CORS**: задайте `CORS_ORIGIN`.

## Чего не хватает

- Аудит-лог deploy/delete.
- Проверка образа перед deploy.
- Health с проверкой Docker socket.
- Лимит контейнеров на пользователя/шаблон.

Уязвимости — через security advisory на GitHub, не в публичных issue.
