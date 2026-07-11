# Manual server deploy

**Русский:** [MANUAL-DEPLOY.ru.md](MANUAL-DEPLOY.ru.md)

Step-by-step: host directories → run container → verify. For Traefik use `run-with-traefik.sh`.

Replace placeholders with your values. Quote `-e` values if they contain `$`, `!`, `)`, or spaces.

---

## 1. SSH and Docker access

```bash
ssh user@your.server
```

User must access Docker (root or `docker` group).

---

## 2. Host directories (once)

```bash
sudo mkdir -p /opt/deployer/templates /opt/deploy-data
sudo chown -R 1000:1000 /opt/deployer/templates
```

Empty `templates/` is seeded from the image on first start (UID 1000 = `node` in image).

---

## 3. Session secret

```bash
openssl rand -hex 32
```

Use output for `DEPLOYER_SECRET`.

---

## 4. Private registry (if needed)

```bash
docker login registry.example.com
```

Required before first deploy of private images.

---

## 5. Run container

Use `--user root` for Docker socket access (otherwise EACCES on deploy).

With Traefik (`proxynet` network):

```bash
docker run -d --name deployer \
  --user root \
  --network proxynet \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD='your-password' \
  -e DEPLOYER_SECRET='your-32-char-secret' \
  -e PORT=3000 \
  -e API_KEY='' \
  -e DEPLOY_BASE_PATH=/opt/deploy-data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/deployer/templates:/app/templates \
  -v /opt/deploy-data:/opt/deploy-data \
  --restart always \
  --label "traefik.enable=true" \
  --label 'traefik.http.routers.deployer.rule=Host(`deploy.your.domain`)' \
  --label "traefik.http.routers.deployer.entrypoints=https" \
  --label "traefik.http.routers.deployer.tls=true" \
  --label "traefik.http.routers.deployer.tls.certresolver=le" \
  --label "traefik.http.services.deployer.loadbalancer.server.port=3000" \
  docker.io/commercedeployer/deployer:latest
```

Without Traefik: add `-p 3000:3000` and omit `--label` / `--network proxynet`.

---

## 6. Verify

```bash
docker ps --filter name=deployer
docker logs deployer
curl -s http://localhost:3000/api/health   # {"ok":true}
```

Open UI: `https://deploy.your.domain` or `http://SERVER_IP:3000`.
