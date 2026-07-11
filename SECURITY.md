# Security

**Русский:** [SECURITY.ru.md](SECURITY.ru.md)

Paths in this document are relative to the **project root**.

## Implemented controls

- **Authentication**: single user from env (`ADMIN_USER` / `ADMIN_PASSWORD`), bcrypt password hash, session cookie (`httpOnly`, `secure` in production, `sameSite=strict` — mitigates CSRF on mutations).
- **API key**: optional `API_KEY`; header `X-API-Key` for non-browser clients. Constant-time comparison (`crypto.timingSafeEqual`).
- **Production**: app refuses to start without a non-default `DEPLOYER_SECRET` when `NODE_ENV=production`.
- **Headers**: Helmet (CSP, etc.). Request body limit 256 KB (DoS mitigation).
- **Rate limits**: login 10 / 15 min; deploy 30/min; template writes 60/min.
- **Volume paths**: on deploy, all host paths in volumes must be **under** `DEPLOY_BASE_PATH`, otherwise rejected.
- **Data removal**: `DELETE /api/containers/:id?removeData=true` deletes only directories **under** `DEPLOY_BASE_PATH`.
- **Managed containers only**: app sees and controls containers with `MANAGED_LABEL` / `MANAGED_LABEL_VALUE` (default `managed-by=deployer`). Use distinct `MANAGED_LABEL_VALUE` per Deployer instance on the same host.
- **Container privileges (`dockerParams`)**: host-escape keys ignored — `Privileged`, `CapAdd`, `Devices`, `DeviceCgroupRules`, etc. (`BLOCKED_HOST_KEYS` in `server/dockerSpec.js`). `SecurityOpt` allows hardening only. `host` namespace modes dropped. `DeviceRequests` (GPU) allowed.

## Recommendations

- **Network**: do not expose the app port directly to the internet; use HTTPS reverse proxy + firewall/VPN.
- **API_KEY**: store in secrets; use separate keys per environment.
- **Templates**: avoid volume paths outside `DEPLOY_BASE_PATH` if you use `removeData=true`.
- **CORS**: set `CORS_ORIGIN` for known clients instead of open cross-origin.
- **Audit logging**: deploy/delete audit trail is not implemented — add middleware if required.

## Known gaps

- No structured audit log (who/when/which template or container).
- No pre-deploy image presence check (pull happens at start).
- Health endpoint (`GET /api/health`) does not ping Docker socket.
- No per-user container count limits (only global deploy rate limit).

Report vulnerabilities privately — see contact section below if added, or open a security advisory on GitHub.
