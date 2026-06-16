# Ручной деплой на сервер

**English:** [MANUAL-DEPLOY.md](MANUAL-DEPLOY.md)

Пошагово: каталоги → контейнер → проверка. С Traefik — `run-with-traefik.sh`.

---

## 1. SSH

Пользователь с доступом к Docker.

## 2. Каталоги

```bash
sudo mkdir -p /opt/deployer/templates /opt/deploy-data
sudo chown -R 1000:1000 /opt/deployer/templates
```

## 3. Секрет

`openssl rand -hex 32` → `SESSION_SECRET`.

## 4. Registry

`docker login registry.example.com` при приватных образах.

## 5. Запуск

`--user root` для docker.sock. Образ: `docker.io/commercedeployer/deployer:latest`. Полная команда — в [MANUAL-DEPLOY.md](MANUAL-DEPLOY.md).

## 6. Проверка

`docker ps`, `docker logs`, `curl /api/health`, UI в браузере.
