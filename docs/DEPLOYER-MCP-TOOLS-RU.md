# Deployer MCP — справочник tools (24)

Полный каталог MCP tools. Playbook: [DEPLOYER-MCP-AGENT-RU.md](DEPLOYER-MCP-AGENT-RU.md).

**Соглашение:** все tools возвращают JSON в `structuredContent` / тексте ответа. `ok: true` — успех.

Оператор может убрать tool из MCP через **`DEPLOYER_MCP_TOOLS_DENY`** (имя как в таблице, через запятую в env).

---

## Meta

### `deployer_capabilities`
**Первый вызов сессии.** Версия, keyId, label, `access: full_api`.

```json
{}
```

### `deployer_health`
Docker probe + `{ ok: true, docker: … }`.

### `deployer_version_get`
`{ version, authMode }` — пакет и режим `dual|api|ui`.

### `deployer_capacity_get`
Снимок CPU/RAM/disk, слоты контейнеров.

### `deployer_substitution_tokens_get`
`GEN_*` токены и `DEPLOY_BASE_PATH` для шаблонов.

---

## Шаблоны

### `deployer_templates_list`
```json
{}
```
→ `{ ok, templates: [{ id, name, description, image, fields }] }`

### `deployer_template_get`
```json
{ "id": "integration-smoke" }
```

### `deployer_template_save` ⚠️
```json
{
  "template": {
    "id": "my-template",
    "name": "…",
    "image": "nginx:alpine",
    "fields": []
  }
}
```

### `deployer_template_delete` ⚠️
```json
{ "id": "my-template" }
```

---

## Deploy и операции

### `deployer_deploy` ⚠️
```json
{
  "templateId": "integration-smoke",
  "containerName": "my-app-01",
  "params": { "HOST_PORT": "8081" }
}
```
→ `{ ok, operation }` или sync result при `DEPLOYER_SYNC_LEGACY=1`.

### `deployer_operation_get`
```json
{ "operationId": "uuid-from-deploy" }
```
Статусы: `queued` | `running` | `succeeded` | `failed`.

---

## Контейнеры

### `deployer_containers_list`
```json
{
  "all": false,
  "q": "search",
  "limit": 20,
  "offset": 0
}
```

### `deployer_container_get`
```json
{
  "id": "container-name-or-docker-id",
  "stats": false,
  "inspect": false
}
```

### `deployer_container_stats`
```json
{ "id": "…" }
```

### `deployer_container_disk`
```json
{ "id": "…" }
```

### `deployer_container_logs`
```json
{
  "id": "…",
  "tail": "100",
  "timestamps": true
}
```

### `deployer_container_start`
```json
{ "id": "…" }
```
→ operation.

### `deployer_container_stop` ⚠️
```json
{ "id": "…" }
```

### `deployer_container_restart` ⚠️
```json
{ "id": "…" }
```

### `deployer_container_delete` ⚠️
```json
{
  "id": "…",
  "removeData": false,
  "templateId": "umami-pg"
}
```
`templateId` нужен при `removeData=true` для deprovision.

---

## Тома

### `deployer_volume_manifest`
```json
{
  "containerName": "my-data",
  "detail": true
}
```

### `deployer_volume_import_session`
```json
{ "containerName": "my-data" }
```
→ token для HTTP `import-stream` на peer.

### `deployer_volume_transfer` ⚠️
```json
{
  "containerName": "my-data",
  "targetBaseUrl": "http://peer:3000",
  "importToken": "from-import-session"
}
```

### `deployer_volume_sync` ⚠️
```json
{
  "containerName": "my-data",
  "targetBaseUrl": "http://peer:3000",
  "importToken": "…",
  "mode": "quiesced"
}
```
`mode`: `quiesced` | `hot`.

---

## Вне MCP

| Сценарий | Почему |
|----------|--------|
| `GET/POST /api/v1/mcp/keys` | Ключи MCP — только web-сессия (UI) |
| `POST /api/login` | Сессия UI |
| `POST …/import-stream` | Поток tar |
| Swagger `/api-docs` | Для человека |

---

## Prompts

| Имя | Назначение |
|-----|------------|
| `deployer_ops_briefing` | Чеклист ops: capacity → containers |
| `deployer_deploy_flow` | Deploy + poll |

## Resources

| URI | Файл |
|-----|------|
| `deployer://docs/mcp-agent` | DEPLOYER-MCP-AGENT-RU.md |
| `deployer://docs/mcp-tools` | Этот файл |
| `deployer://docs/mcp` | DEPLOYER-MCP-v1-RU.md |
| `deployer://docs/api-integration` | API-INTEGRATION.ru.md |
| `deployer://docs/agent-guide` | AGENT-GUIDE.ru.md |
