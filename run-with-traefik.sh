#!/bin/bash
# Run Deployer behind Traefik (proxynet). Can be run from any directory.
# Set: DOMAIN, ADMIN_PASSWORD, DEPLOYER_SECRET (and IMAGE if needed).
#
# Before first run on server:
#   sudo mkdir -p /opt/deployer/templates /opt/deploy-data
#   sudo chown -R 1000:1000 /opt/deployer/templates
# Private images: docker login && docker pull <image> on host before first deploy.

DOMAIN="${DOMAIN:-example.com}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD}"
DEPLOYER_SECRET="${DEPLOYER_SECRET:?Set DEPLOYER_SECRET}"
IMAGE="${IMAGE:-deployer:latest}"

HOST="deploy.${DOMAIN}"

if ! docker network inspect proxynet &>/dev/null; then
  echo "Creating proxynet network..."
  docker network create proxynet
fi

# --user root required for /var/run/docker.sock access on deploy (otherwise EACCES)
docker run -d --name deployer \
  --user root \
  --network proxynet \
  -e ADMIN_USER="$ADMIN_USER" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e DEPLOYER_SECRET="$DEPLOYER_SECRET" \
  -e DEPLOY_BASE_PATH=/opt/deploy-data \
  -e TZ=Europe/Moscow \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/deployer/templates:/app/templates \
  -v /opt/deploy-data:/opt/deploy-data \
  --restart always \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.deployer.rule=Host(\`$HOST\`)" \
  --label "traefik.http.routers.deployer.entrypoints=https" \
  --label "traefik.http.routers.deployer.tls=true" \
  --label "traefik.http.routers.deployer.tls.certresolver=le" \
  --label "traefik.http.services.deployer.loadbalancer.server.port=3000" \
  "$IMAGE"

echo "deployer started. Open: https://$HOST"
