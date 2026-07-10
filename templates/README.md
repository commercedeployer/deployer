# Container templates

**Русский:** [README.ru.md](README.ru.md)

JSON files in `templates/`. If the mounted folder is empty, Deployer seeds it from bundled templates inside the image on startup.

## Container name

**Not in template JSON.** Set at **deploy** time:

| Client | How |
|--------|-----|
| **Deployer UI** | «Container name» field in deploy form |
| **HTTP API** | `containerName` in `POST /api/deploy` body |

Template defines image, ports, env, volumes. Persistent volumes: `{{DEPLOY_BASE_PATH}}/{{CONTAINER_NAME}}/…` — `CONTAINER_NAME` comes from deploy context, not from `fields`.

## docker-demo — plan change

Three tiers (free/basic/pro): same image, **same** container name on redeploy, **one** bind mount `…/{{CONTAINER_NAME}}/demo-data`. Tier changes via env/labels.

## Placeholders

| Kind | Example | Source |
|------|---------|--------|
| Deploy | `{{CONTAINER_NAME}}` | API / UI deploy (not fields) |
| Form fields | `{{HOST_PORT}}`, `{{DOMAIN}}` | `params` |
| Server context | `{{DEPLOY_BASE_PATH}}` | Deployer env |
| UI default | `{{GEN_UUID}}` | field default in `fields` |

Unresolved `{{KEY}}` → deploy error.

## Format

- **id**, **name**, **image** — required.
- **fields**, **env**, **volumes**, **labels**, **networks**, **ports** — see bundled JSON examples.
- **containerName** in template root — **not used** (removed legacy).
