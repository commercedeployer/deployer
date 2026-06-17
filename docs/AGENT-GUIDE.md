# AI agent guide (Deployer)

**Русский:** [AGENT-GUIDE.ru.md](AGENT-GUIDE.ru.md)

Deployer is an open-source app for deploying Docker containers from JSON templates. HTTP clients (billing panels, scripts) call the REST API.

VPS install with Traefik — **[Setup Server Stack](https://github.com/commercedeployer/setup-server-stack)** (sibling OSS project).

---

## Source of truth

1. **Code:** `server/`, `public/`, `templates/*.json`
2. **Tests:** `test/*.test.js`, `test/integration/`
3. **API contract:** `server/openapi.json`, UI `/api-docs`, `docs/API-INTEGRATION.md`
4. **Docs:** `README.md`, `templates/README.md`, `SECURITY-AUDIT.md`

---

## Default templates

| id | Purpose |
|----|---------|
| `docker-demo-free` / `basic` / `pro` | Demo tiers |
| `integration-smoke` | Integration tests |
| `docker-getting-started` | Smoke without tier |
| `mariadb` | Database |
| `wordpress` | WordPress, `DB_HOST` in form |

Proprietary stacks — JSON import in template editor, not in public catalog.

---

## Deploy identity

- Deploy: **`containerName`** + `templateId` + `params` (not `instanceId`).
- Async: `POST /api/deploy` → 202, poll `GET /api/operations/:id`, header `x-api-key`.
- Duplicate active **`containerName`** → 409.
- Volumes: `{{CONTAINER_NAME}}` from deploy context.
- Legacy sync: `DEPLOYER_SYNC_LEGACY=1` → 200 + `container` in body.

---

## Do not confuse

| | Deployer | Setup Server Stack |
|---|----------|-------------------|
| Role | Containers by template | Traefik, registry, Deployer as service |
| Entry | `npm start`, own Docker image | `setup-server-stack.sh` |
| Image | `Dockerfile`, CI → `commercedeployer/deployer` or `ghcr.io/commercedeployer/deployer` | `DEPLOYER_IMAGE` env |

---

## Tests

```bash
npm test
npm run test:integration   # Docker required
```

UI smoke: start server, `npm run test:ui`.
