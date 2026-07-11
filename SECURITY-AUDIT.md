# Security audit

**Русский:** [SECURITY-AUDIT.ru.md](SECURITY-AUDIT.ru.md)

Date: 2025–2026. App: container deploy admin (Node/Express, Docker API). Paths relative to **project root**.

---

## 1. Strengths (implemented)

| Area | Implementation |
|------|----------------|
| **Authentication** | Single env user, bcrypt, session cookie (httpOnly, secure in prod, sameSite=strict). Optional API key (X-API-Key), constant-time compare. |
| **Authorization** | All API except `/api/login`, `/api/health` behind `requireAuth` (session or API key). |
| **Rate limits** | Login 10/15 min, deploy 30/min, templates 60/min. |
| **Headers** | Helmet (CSP, etc.). |
| **Templates** | Template ID regex `SAFE_ID`; file path via fixed directory — no path traversal by ID. |
| **Data removal** | `removeData=true` only under `DEPLOY_BASE_PATH` (`path.resolve` + `startsWith`). |
| **Frontend** | Template/field output via `escapeHtml` / `escapeAttr`. |
| **Dockerfile** | Entrypoint installs `DEPLOYER_SOFTWARE` as root; with `docker.sock` mounted the process stays root (API access), otherwise `su-exec node`. |

---

## 2. Risks and recommendations

### 2.1 Critical / high

| Risk | Description | Recommendation |
|------|-------------|----------------|
| **Default DEPLOYER_SECRET** | Predictable session signing if unset. | **Fixed:** production exit if default/missing secret. |
| **Volume paths on deploy** | Arbitrary host bind mounts. | **Fixed:** validate all host paths under `DEPLOY_BASE_PATH`. |
| **Delete any container** | Accidental system container removal. | **Fixed:** managed label filter. |
| **Unbounded JSON body** | Memory DoS. | **Fixed:** `express.json({ limit: '256kb' })`. |

### 2.2 Medium

| Risk | Description | Recommendation |
|------|-------------|----------------|
| **CORS** | `origin: true` in dev. | Set `CORS_ORIGIN` in production. |
| **API key timing** | String compare. | **Fixed:** `crypto.timingSafeEqual`. |
| **Deploy params** | Weak schema validation. | Validate by template (domain format, length, control chars). |
| **Public Swagger** | `/api-docs` without auth. | OK for internal tools; protect on public hosts. |

### 2.3 Low / informational

| Risk | Description | Recommendation |
|------|-------------|----------------|
| **Logging** | No structured audit. | Middleware for login/deploy/delete/template changes. |
| **Health** | No Docker ping. | Optional 503 if socket unavailable. |
| **Dependencies** | npm vulnerabilities. | `npm audit`, Dependabot. |

---

## 3. Environment dependencies

- **Network**: HTTPS reverse proxy; restrict access.
- **Docker**: socket access = host control within Docker capabilities.
- **Filesystem**: writes to `templates/`; `removeData` only under `DEPLOY_BASE_PATH`.

---

## 4. Improvement backlog

1. **Done:** JSON limit, DEPLOYER_SECRET check, volume path validation, managed labels, privilege jail, API key timing, sameSite=strict.
2. **Nice:** stricter CORS in prod, audit log, param sanitization, Docker health.

---

## 5. External review (2026-06)

- **Privilege jail** (`server/dockerSpec.js`): `Privileged`, `CapAdd`, `Devices`, `DeviceCgroupRules` in `BLOCKED_HOST_KEYS`. `SecurityOpt` hardening only. `host` namespace modes dropped. `DeviceRequests` (GPU) kept.
- **API key**: `crypto.timingSafeEqual` in `server/auth.js`.
- **Session**: `sameSite=strict` for CSRF mitigation on admin mutations.
