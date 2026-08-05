#!/usr/bin/env bash
# Build Aico from this repo and deploy via docker-compose/deploy.
#
# Usage:
#   ./scripts/deploy-local.sh                 # deploy existing image (default)
#   ./scripts/deploy-local.sh -u             # build + deploy after code changes
#   ./scripts/deploy-local.sh -b             # build image only
#   ./scripts/deploy-local.sh -s             # stop the deployment
#
# Optional env:
#   AICO_LEGACY_DEPLOY_DIR  One-time .env migration source (default: ~/docker-lobehub/lobehub-db)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/docker-compose/deploy"
IMAGE="aico/lobehub:local"
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)"
LEGACY_DEPLOY_DIR="${AICO_LEGACY_DEPLOY_DIR:-$HOME/docker-lobehub/lobehub-db}"
CONTAINER_NAME="lobehub"
STAGE=""

BUILD=0
DEPLOY=1
STOP=0
for arg in "$@"; do
  case "$arg" in
    --up|--ship|-u) BUILD=1 ;;
    --deploy-only|-d) BUILD=0 ;;
    --build-only|-b) BUILD=1; DEPLOY=0 ;;
    --stop|--down|-s) STOP=1; BUILD=0; DEPLOY=0 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [-u|--up] [--build-only|-b] [--stop|-s]

Deploy Aico via docker-compose/deploy using the local image in this repo.

Options:
  (default)           Redeploy the existing local image (skip build)
  -u, --up, --ship    Build from source, then deploy
  -d, --deploy-only   Same as default (redeploy without building)
  -b, --build-only    Build and tag the image only (skip deploy)
  -s, --stop, --down  Stop the deployment containers

Environment:
  AICO_LEGACY_DEPLOY_DIR   Legacy deploy directory for one-time .env migration
                           (default: ~/docker-lobehub/lobehub-db)
EOF
      exit 0
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  local msg="${2:-$cmd is required}"
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Error: $msg" >&2
    exit 1
  }
}

cleanup_stage() {
  [[ -n "$STAGE" && -d "$STAGE" ]] && rm -rf "$STAGE"
}

wait_for_container() {
  local name="$1"
  local timeout="${2:-120}"
  local elapsed=0
  local status="missing"

  while (( elapsed < timeout )); do
    status="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo "missing")"
    case "$status" in
      running) return 0 ;;
      exited|dead)
        echo "Error: container $name is $status" >&2
        docker logs "$name" 2>&1 | tail -20 >&2 || true
        return 1
        ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "Error: timed out waiting for container $name (last status: $status)" >&2
  return 1
}

wait_for_http() {
  local url="$1"
  local timeout="${2:-120}"
  local elapsed=0
  local code="000"

  while (( elapsed < timeout )); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")"
    if [[ "$code" == "200" || "$code" == "302" ]]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "Error: timed out waiting for $url (last HTTP $code)" >&2
  return 1
}

require_cmd docker
require_cmd git
docker compose version >/dev/null 2>&1 || {
  echo "Error: docker compose is required." >&2
  exit 1
}
[[ $BUILD -eq 1 ]] && require_cmd bun
[[ $DEPLOY -eq 1 ]] && require_cmd curl

# One-time migration from a legacy external deploy dir. After deploy/.env exists, edit it directly.
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  if [[ -f "$LEGACY_DEPLOY_DIR/.env" ]]; then
    echo "Creating infra-only deploy env from legacy deploy dir → $DEPLOY_DIR/.env"
    require_cmd python3
    python3 <<PY
from pathlib import Path

src = Path("$LEGACY_DEPLOY_DIR/.env")
dst = Path("$DEPLOY_DIR/.env")
keep = {
    'LOBE_PORT', 'RUSTFS_PORT', 'RUSTFS_ADMIN_PORT', 'LOBE_DB_NAME', 'POSTGRES_PASSWORD',
    'RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY', 'RUSTFS_LOBE_BUCKET', 'JWKS_KEY',
}
out = []
for line in src.read_text().splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith('#') or '=' not in line:
        continue
    key, _ = line.split('=', 1)
    if key in keep:
        out.append(line)
dst.write_text('\n'.join(out) + '\n')
PY
  else
    echo "Missing $DEPLOY_DIR/.env — copy from docker-compose/deploy/.env.example.aico and configure infra secrets." >&2
    exit 1
  fi
fi

if [[ $STOP -eq 1 ]]; then
  echo "==> Stopping deployment from $DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  docker compose \
    --env-file ../../.env \
    --env-file .env \
    -f docker-compose.yml \
    -f docker-compose.aico.override.yml \
    down
  echo "==> Deployment stopped"
  exit 0
fi

if [[ $BUILD -eq 1 ]]; then
  echo "==> Building app (DOCKER=true bun run build:docker)"
  cd "$ROOT"
  DOCKER=true bun run build:docker

  required_paths=(
    "$ROOT/.next/standalone"
    "$ROOT/.next/static"
    "$ROOT/public/_spa"
    "$ROOT/public/_spa-auth"
    "$ROOT/public/_spa-workbench"
    "$ROOT/packages/database/migrations"
    "$ROOT/scripts/migrateServerDB/docker.cjs"
    "$ROOT/scripts/migrateServerDB/errorHint.js"
    "$ROOT/scripts/_shared"
    "$ROOT/scripts/serverLauncher/startServer.js"
    "$ROOT/scripts/docker/Dockerfile.staged"
  )
  for path in "${required_paths[@]}"; do
    [[ -e "$path" ]] || {
      echo "Error: missing build artifact: $path" >&2
      exit 1
    }
  done

  echo "==> Packaging Docker image $IMAGE"
  STAGE="$(mktemp -d)"
  trap cleanup_stage EXIT

  mkdir -p "$STAGE/.next" "$STAGE/public" "$STAGE/packages/database" \
    "$STAGE/scripts/migrateServerDB" "$STAGE/scripts/_shared"

  cp -a "$ROOT/.next/standalone/." "$STAGE/"
  cp -a "$ROOT/.next/static" "$STAGE/.next/static"
  cp -a "$ROOT/public/_spa" "$ROOT/public/_spa-auth" "$ROOT/public/_spa-workbench" "$STAGE/public/"
  cp -a "$ROOT/packages/database/migrations" "$STAGE/packages/database/"
  cp "$ROOT/scripts/migrateServerDB/docker.cjs" "$ROOT/scripts/migrateServerDB/errorHint.js" \
    "$STAGE/scripts/migrateServerDB/"
  cp -a "$ROOT/scripts/_shared/." "$STAGE/scripts/_shared/"
  cp "$ROOT/scripts/serverLauncher/startServer.js" "$STAGE/startServer.js"
  cp "$ROOT/scripts/docker/Dockerfile.staged" "$STAGE/Dockerfile"

  docker build -t "$IMAGE" -t "aico/lobehub:$TAG" "$STAGE"
  echo "==> Image ready: $IMAGE (also tagged aico/lobehub:$TAG)"
fi

if [[ $DEPLOY -eq 1 ]]; then
  echo "==> Deploying from $DEPLOY_DIR"
  cd "$DEPLOY_DIR"

  # Stop legacy external deploy if still running
  if [[ -f "$LEGACY_DEPLOY_DIR/docker-compose.yml" ]]; then
    (cd "$LEGACY_DEPLOY_DIR" && docker compose down 2>/dev/null) || true
  fi

  docker compose \
    --env-file ../../.env \
    --env-file .env \
    -f docker-compose.yml \
    -f docker-compose.aico.override.yml \
    up -d --force-recreate lobe

  echo "==> Waiting for container $CONTAINER_NAME..."
  wait_for_container "$CONTAINER_NAME" 120

  APP_PORT="$(grep -E '^LOBE_PORT=' "$DEPLOY_DIR/.env" | cut -d= -f2- || true)"
  APP_URL="http://127.0.0.1:${APP_PORT:-3210}"

  echo "==> Waiting for HTTP readiness at $APP_URL ..."
  if wait_for_http "$APP_URL/signin" 120; then
    echo "==> Deployment healthy"
    docker logs "$CONTAINER_NAME" 2>&1 | tail -8
    echo ""
    echo "App: $APP_URL"
  else
    echo "==> Deployment failed readiness check" >&2
    docker logs "$CONTAINER_NAME" 2>&1 | tail -30 >&2
    exit 1
  fi
fi
