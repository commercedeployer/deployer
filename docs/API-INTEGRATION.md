# HTTP API — client integration (v1)

**Русский:** [API-INTEGRATION.ru.md](API-INTEGRATION.ru.md)

Deployer is a standalone service: any HTTP client (billing panel, CI, script) can call the REST API. Spec: **`/api-docs`** (OpenAPI `server/openapi.json`).

## Authentication

| Mode | Env | How |
|------|-----|-----|
| UI | `ADMIN_USER` / `ADMIN_PASSWORD` | cookie session after `POST /api/login` |
| API | `API_KEY` | header `X-API-Key` |
| Both | `DEPLOYER_AUTH_MODE=dual` (default) | session or key |

For server-to-server integration use **API key only** — no cookies.

## Deploy (async, primary path)

```
POST /api/deploy
X-API-Key: <key>
Content-Type: application/json

{
  "templateId": "docker-demo-free",
  "containerName": "a1b2c3d4e5f6",
  "params": { "DOMAIN": "app.example.com" }
}
```

Response **202**:

```json
{
  "ok": true,
  "operationId": "op-…",
  "operation": { "status": "running", "phase": "pull", … }
}
```

Poll until `succeeded` / `failed`:

```
GET /api/operations/:operationId
```

On success, `operation.result`:

```json
{
  "container": { "id": "…", "name": "…", "state": "running" }
}
```

### Identity

- **`containerName`** — unique Docker name; client generates and stores (e.g. 24-char hex).
- Template volumes: `{{CONTAINER_NAME}}` from deploy context, not from template JSON.
- Redeploy with same `containerName` + `params` restores data under `DEPLOY_BASE_PATH`.
- Duplicate active `containerName` → **409**.

Legacy sync: `DEPLOYER_SYNC_LEGACY=1` → **200** with `container` in body (not recommended for new integrations).

## Lifecycle

Mutations are async → **202** + `operationId`:

| Action | Endpoint |
|--------|----------|
| List | `GET /api/containers?limit=&offset=&q=` |
| Details | `GET /api/containers/:id` |
| Logs | `GET /api/containers/:id/logs?tail=500` |
| Start | `POST /api/containers/:id/start` |
| Stop | `POST /api/containers/:id/stop` |
| Restart | `POST /api/containers/:id/restart` |
| Delete | `DELETE /api/containers/:id?removeData=false&templateId=…` |

`removeData=true` deletes host data under `DEPLOY_BASE_PATH/<identifier>/`. Template for `deprovision`: `templateId` query → else `deployer.templateId` label. If neither — disk only. Container gone + `removeData=true` → 202, purge by identifier.

`removeData=false` removes only the container; volumes and DB objects from provision remain.

See [PROVISION-v1-RU.md](PROVISION-v1-RU.md).

List response: `containers[]`, `total`, `page`, `total_pages`, `has_more`, `container_limit`.

## Capacity (placement)

`GET /api/capacity` — physical node snapshot for Commerce placement:

- `total_containers` — managed containers in Docker (Commerce uses as `docker_containers`)
- `container_limit` — `CONTAINER_LIMIT` env on this deployer
- `free_slots` — deployer-side remainder (`container_limit − total_containers`); Commerce computes **headroom** separately (parked instances, pending deploys)

Commerce combines this with license counts (`entitled`) from its database; see Commerce `DEPLOYER-PLACEMENT-AND-VOLUMES-v1-RU.md`.

## Managed containers

Deployer sees only containers with label:

- `MANAGED_LABEL` (default: `managed-by`)
- `MANAGED_LABEL_VALUE` (default: `deployer`)

Label is set on create. Multiple Deployer instances on one host — different `MANAGED_LABEL_VALUE`.

On every deploy, Deployer also sets:

- `deployer.containerName` — from API `containerName`;
- `deployer.templateId` — from API `templateId` (used for deprovision when `removeData=true`).

See [PROVISION-v1-RU.md](PROVISION-v1-RU.md).

## Templates

- `GET /api/templates`, `GET /api/templates/:id`
- `POST /api/templates` — create/update (UI or import)
- JSON format: `templates/README.md`

`params` must satisfy all `{{KEY}}` placeholders; missing value → deploy error.

## Health

```
GET /api/health
```

No auth, `{ "ok": true }`.

## Environment

Full list: `.env.example` (`MAX_CONCURRENT_OPERATIONS`, `REGISTRY_*`, `CORS_ORIGIN`, …).

## curl example

```bash
export DEPLOYER_URL=https://deploy.example.com
export API_KEY=your-key

curl -sS -X POST "$DEPLOYER_URL/api/deploy" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"templateId":"integration-smoke","containerName":"smoke-'"$(openssl rand -hex 6)"'","params":{}}'
```

Poll:

```bash
curl -sS -H "X-API-Key: $API_KEY" "$DEPLOYER_URL/api/operations/$OPERATION_ID"
```
