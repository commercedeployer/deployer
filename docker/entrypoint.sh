#!/bin/sh
# Install optional Alpine packages for provision/deprovision (DEPLOYER_SOFTWARE).
# node is always available from the base image — not part of DEPLOYER_SOFTWARE.
set -eu

MARKER="/var/lib/deployer/.software-installed"

map_key_to_pkg() {
  case "$1" in
    bash) printf '%s' 'bash' ;;
    psql|postgres) printf '%s' 'postgresql-client' ;;
    mysql|mariadb) printf '%s' 'mariadb-client' ;;
    mongosh|mongo) printf '%s' 'mongosh' ;;
    curl) printf '%s' 'curl' ;;
    jq) printf '%s' 'jq' ;;
    python3|python) printf '%s' 'python3' ;;
    openssl) printf '%s' 'openssl' ;;
    rsync) printf '%s' 'rsync' ;;
    openssh|openssh-client|ssh) printf '%s' 'openssh-client' ;;
    bind|dig|nslookup) printf '%s' 'bind-tools' ;;
    zip) printf '%s' 'zip' ;;
    *) return 1 ;;
  esac
}

resolve_pkg_list() {
  raw="${DEPLOYER_SOFTWARE:-bash,curl}"
  raw="$(printf '%s' "$raw" | tr ',;' ' \n' | tr '[:upper:]' '[:lower:]')"
  pkgs=""
  seen=""
  token pkg
  for token in $raw; do
    [ -n "$token" ] || continue
    pkg="$(map_key_to_pkg "$token")" || continue
    case " $seen " in
      *" $pkg "*) continue ;;
    esac
    seen="$seen $pkg"
    pkgs="$pkgs $pkg"
  done
  printf '%s' "$pkgs" | sed 's/^ //'
}

ensure_mongosh_repo() {
  grep -q '/community$' /etc/apk/repositories 2>/dev/null && return 0
  if [ -f /etc/alpine-release ]; then
  alpine_ver="$(cut -d. -f1,2 </etc/alpine-release)"
  echo "https://dl-cdn.alpinelinux.org/alpine/v${alpine_ver}/community" >> /etc/apk/repositories
  fi
}

install_software() {
  desired="${DEPLOYER_SOFTWARE:-bash,curl}"
  if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$desired" ]; then
    return 0
  fi
  if [ "$(id -u)" != "0" ]; then
    echo "[deployer] warning: DEPLOYER_SOFTWARE ignored (container not running as root for apk install)"
    return 0
  fi

  pkg_list="$(resolve_pkg_list)"
  if [ -z "$pkg_list" ]; then
    echo "[deployer] warning: DEPLOYER_SOFTWARE has no valid package keys"
    mkdir -p /var/lib/deployer
    printf '%s' "$desired" >"$MARKER"
    return 0
  fi

  case " $pkg_list " in
    *" mongosh "*) ensure_mongosh_repo ;;
  esac

  apk update -q
  # shellcheck disable=SC2086
  apk add --no-cache $pkg_list

  mkdir -p /var/lib/deployer
  printf '%s' "$desired" >"$MARKER"
}

install_software

# Deployer needs Docker API. Bind-mounted sockets are often root-only (incl. Docker Desktop).
# No env toggle: if socket is present, keep root; otherwise drop to node (local runs without Docker).
if [ "$(id -u)" = "0" ]; then
  if [ ! -e /var/run/docker.sock ]; then
    exec su-exec node "$@"
  fi
fi

exec "$@"
