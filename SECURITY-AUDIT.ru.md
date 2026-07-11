# Аудит безопасности Deployer

**English:** [SECURITY-AUDIT.md](SECURITY-AUDIT.md)

Дата: 2025–2026. Пути — относительно **корня проекта**.

---

## 1. Сильные стороны

| Область | Реализация |
|--------|------------|
| **Аутентификация** | Env user, bcrypt, cookie, API key, constant-time. |
| **Авторизация** | requireAuth на API (кроме login/health). |
| **Rate limit** | Логин, deploy, шаблоны. |
| **Шаблоны** | SAFE_ID, path.join — без traversal по ID. |
| **Удаление данных** | Только под DEPLOY_BASE_PATH. |
| **Фронтенд** | escapeHtml/escapeAttr. |
| **Dockerfile** | Entrypoint ставит `DEPLOYER_SOFTWARE` от root; при смонтированном `docker.sock` процесс остаётся root (доступ к API), иначе `su-exec node`. |

---

## 2. Риски

Критичные пункты (DEPLOYER_SECRET, лимит JSON, пути томов, managed label, privilege jail, API key timing) — **закрыты**. См. английскую версию для таблиц.

---

## 3. Окружение

Сеть, Docker socket, права на `templates/` и `DEPLOY_BASE_PATH`.

---

## 4. Бэклог

CORS в prod, аудит-лог, санитизация params, health с Docker.

---

## 5. Review 2026-06

Jail `dockerParams`, `timingSafeEqual`, `sameSite=strict` — см. [SECURITY-AUDIT.md](SECURITY-AUDIT.md).
