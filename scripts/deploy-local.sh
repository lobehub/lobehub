#!/usr/bin/env bash
# Build Aico from this repo and deploy via docker-compose/deploy.
#
# Usage:
#   ./scripts/deploy-local.sh              # start if not running (default)
#   ./scripts/deploy-local.sh -u|--up      # build + deploy
#   ./scripts/deploy-local.sh -b|--build   # build image only
#   ./scripts/deploy-local.sh -d|--deploy  # force redeploy (recreate)
#   ./scripts/deploy-local.sh -r|--restart # restart containers
#   ./scripts/deploy-local.sh -i|--info    # containers / HTTP / migrations
#   ./scripts/deploy-local.sh -k|--kill    # stop containers
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
POSTGRES_CONTAINER="lobe-postgres"
STAGE=""

BUILD=0
DEPLOY=0
STOP=0
STATUS=0
RESTART=0
START_IF_NEEDED=0

if [[ $# -eq 0 ]]; then
  START_IF_NEEDED=1
fi

for arg in "$@"; do
  case "$arg" in
    -u|--up|--ship|up) BUILD=1; DEPLOY=1; START_IF_NEEDED=0 ;;
    -d|--deploy|--deploy-only|deploy) DEPLOY=1; START_IF_NEEDED=0 ;;
    -b|--build|--build-only|build) BUILD=1; DEPLOY=0; START_IF_NEEDED=0 ;;
    -r|--restart|restart) RESTART=1; START_IF_NEEDED=0 ;;
    -i|--info|info|status|--status) STATUS=1; BUILD=0; DEPLOY=0; STOP=0; RESTART=0; START_IF_NEEDED=0 ;;
    -k|--kill|kill|stop|--stop|--down) STOP=1; BUILD=0; DEPLOY=0; RESTART=0; START_IF_NEEDED=0 ;;
    -s|-S)
      echo "Error: $arg removed. Use distinct letters:" >&2
      echo "  moz -i   info / status" >&2
      echo "  moz -k   kill / stop containers" >&2
      echo "  moz -r   restart containers" >&2
      exit 2
      ;;
    -t)
      echo "Error: -t removed. Use: moz -i / moz --info" >&2
      exit 2
      ;;
    -h|--help|help)
      cat <<EOF
Usage: moz [options]

Deploy Aico via docker-compose/deploy using the local image in this repo.

Options (each has a distinct one-letter flag):
  (default)             Start stack only if not already running
  -u, --up, up          Build from source, then force-deploy
  -d, --deploy, deploy  Force redeploy / recreate (no build)
  -b, --build, build    Build and tag the image only (skip deploy)
  -r, --restart, restart  Restart running containers (start if stopped)
  -i, --info, info      Show containers, HTTP, image, and DB migration status
  -k, --kill, kill      Stop the deployment containers
  -h, --help, help      Show this help

Aliases (same actions):
  --ship                → -u
  --deploy-only         → -d
  --build-only          → -b
  status, --status      → -i
  stop, --stop, --down  → -k

Environment:
  AICO_LEGACY_DEPLOY_DIR   Legacy deploy directory for one-time .env migration
                           (default: ~/docker-lobehub/lobehub-db)
EOF
      exit 0
      ;;
    -*)
      echo "Error: unknown option: $arg (try: moz -h)" >&2
      exit 2
      ;;
    *)
      echo "Error: unknown argument: $arg (try: moz -h)" >&2
      exit 2
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
[[ $DEPLOY -eq 1 || $STATUS -eq 1 || $START_IF_NEEDED -eq 1 || $RESTART -eq 1 ]] && require_cmd curl

app_url() {
  local app_port
  app_port="$(grep -E '^LOBE_PORT=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  echo "http://127.0.0.1:${app_port:-3210}"
}

is_app_running() {
  [[ "$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo missing)" == "running" ]]
}

compose_in_deploy_dir() {
  (
    cd "$DEPLOY_DIR"
    docker compose \
      --env-file ../../.env \
      --env-file .env \
      -f docker-compose.yml \
      -f docker-compose.aico.override.yml \
      "$@"
  )
}

stop_legacy_deploy() {
  if [[ -f "$LEGACY_DEPLOY_DIR/docker-compose.yml" ]]; then
    (cd "$LEGACY_DEPLOY_DIR" && docker compose down 2>/dev/null) || true
  fi
}

verify_deploy_health() {
  local url migrate_line
  url="$(app_url)"

  echo "==> Waiting for container $CONTAINER_NAME..."
  wait_for_container "$CONTAINER_NAME" 120

  echo "==> Waiting for HTTP readiness at $url ..."
  if ! wait_for_http "$url/signin" 120; then
    echo "==> Deployment failed readiness check" >&2
    docker logs "$CONTAINER_NAME" 2>&1 | tail -30 >&2
    return 1
  fi

  echo "==> Deployment healthy"

  migrate_line="$(docker logs "$CONTAINER_NAME" 2>&1 | grep -iE 'database migration|DB Migration|Skipping DB migration' | tail -5 || true)"
  if printf '%s\n' "$migrate_line" | grep -qiE 'Skipping DB migration|Refusing to start|Database migrate failed'; then
    echo "==> Migration check failed:" >&2
    printf '%s\n' "$migrate_line" | sed 's/^/  /' >&2
    return 1
  fi
  if printf '%s\n' "$migrate_line" | grep -q 'database migration pass'; then
    echo "==> DB migration: ok"
  else
    echo "==> Warning: no migration-pass log line found (check DATABASE_DRIVER / SKIP_DB_MIGRATE)"
    printf '%s\n' "$migrate_line" | sed 's/^/  /'
  fi

  docker logs "$CONTAINER_NAME" 2>&1 | tail -8
  echo ""
  echo "App: $url"
}

container_state() {
  local name="$1"
  docker inspect -f '{{.State.Status}}{{if .State.Health}} ({{.State.Health.Status}}){{end}}' "$name" 2>/dev/null || echo "missing"
}

show_status() {
  local app_port app_url http_code image_id image_created
  local expected_migrations applied_migrations migrate_log docker_cjs migrations_dir
  local user_count admin_count exit_code=0

  app_port="$(grep -E '^LOBE_PORT=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  app_url="http://127.0.0.1:${app_port:-3210}"

  echo "Aico deploy status"
  echo "------------------"
  printf "App URL:     %s\n" "$app_url"
  printf "Repo HEAD:   %s\n" "$TAG"
  printf "Image:       %s\n" "$IMAGE"

  image_id="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
  if [[ -n "$image_id" ]]; then
    image_created="$(docker image inspect "$IMAGE" --format '{{.Created}}' 2>/dev/null || true)"
    printf "Image ID:    %s\n" "${image_id#sha256:}"
    printf "Image built: %s\n" "$image_created"
  else
    echo "Image ID:    missing (run: moz -u)"
    exit_code=1
  fi

  echo ""
  echo "Containers"
  printf "  %-16s %s\n" "lobehub" "$(container_state lobehub)"
  printf "  %-16s %s\n" "lobe-postgres" "$(container_state lobe-postgres)"
  printf "  %-16s %s\n" "lobe-redis" "$(container_state lobe-redis)"
  printf "  %-16s %s\n" "lobe-rustfs" "$(container_state lobe-rustfs)"

  http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$app_url/signin" 2>/dev/null || echo "000")"
  printf "\nHTTP /signin: %s\n" "$http_code"
  if [[ "$http_code" != "200" && "$http_code" != "302" ]]; then
    exit_code=1
  fi

  # Migration packaging inside the running app image
  if docker inspect lobehub >/dev/null 2>&1; then
    docker_cjs="$(docker exec lobehub sh -c 'test -f /app/docker.cjs && echo ok || echo missing' 2>/dev/null || echo unreachable)"
    migrations_dir="$(docker exec lobehub sh -c 'test -d /app/migrations && echo ok || echo missing' 2>/dev/null || echo unreachable)"
    printf "Auto-migrate: docker.cjs=%s migrations=%s\n" "$docker_cjs" "$migrations_dir"
    if [[ "$docker_cjs" != "ok" || "$migrations_dir" != "ok" ]]; then
      echo "  (broken packaging — app should refuse to start until next moz -u)"
      exit_code=1
    fi

    migrate_log="$(docker logs lobehub 2>&1 | grep -iE 'database migration|DB Migration|Skipping DB migration|Refusing to start' | tail -3 || true)"
    if [[ -n "$migrate_log" ]]; then
      echo ""
      echo "Migration log (recent):"
      printf '%s\n' "$migrate_log" | sed 's/^/  /'
    fi
    if printf '%s\n' "$migrate_log" | grep -qiE 'Skipping DB migration|Refusing to start|Database migrate failed'; then
      exit_code=1
    fi
  fi

  expected_migrations="$(python3 -c "import json; print(len(json.load(open('$ROOT/packages/database/migrations/meta/_journal.json'))['entries']))" 2>/dev/null || echo "?")"
  if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 \
    && [[ "$(docker inspect -f '{{.State.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" == "running" ]]; then
    applied_migrations="$(
      docker exec "$POSTGRES_CONTAINER" psql -U postgres -d lobechat -Atc \
        "SELECT count(*) FROM drizzle.__drizzle_migrations;" 2>/dev/null || echo "?"
    )"
    user_count="$(
      docker exec "$POSTGRES_CONTAINER" psql -U postgres -d lobechat -Atc \
        "SELECT count(*) FROM users;" 2>/dev/null || echo "?"
    )"
    admin_count="$(
      docker exec "$POSTGRES_CONTAINER" psql -U postgres -d lobechat -Atc \
        "SELECT count(*) FROM platform_admins;" 2>/dev/null || echo "n/a"
    )"
    printf "\nDB migrations: %s / %s applied\n" "$applied_migrations" "$expected_migrations"
    printf "Users:         %s\n" "$user_count"
    printf "Platform admins: %s\n" "$admin_count"
    if [[ "$applied_migrations" =~ ^[0-9]+$ && "$expected_migrations" =~ ^[0-9]+$ ]]; then
      if (( applied_migrations < expected_migrations )); then
        echo "  ⚠️  DB behind repo — run: bun run db:migrate   (or moz -u after packaging fix)"
        exit_code=1
      fi
    fi
  else
    echo ""
    echo "DB:            postgres not running"
    exit_code=1
  fi

  echo ""
  if [[ $exit_code -eq 0 ]]; then
    echo "Status: OK"
  else
    echo "Status: issues detected"
  fi
  return "$exit_code"
}

# One-time migration from a legacy external deploy dir. After deploy/.env exists, edit it directly.
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  if [[ $STATUS -eq 1 ]]; then
    echo "Missing $DEPLOY_DIR/.env — stack not configured yet." >&2
    exit 1
  fi
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

if [[ $STATUS -eq 1 ]]; then
  set +e
  show_status
  exit $?
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

  # Layout must match startServer.js + docker.cjs expectations:
  #   /app/docker.cjs, /app/errorHint.js, /app/migrations
  # (same as root Dockerfile / Dockerfile.prebuilt — not nested under scripts/)
  mkdir -p "$STAGE/.next" "$STAGE/public" "$STAGE/scripts/_shared"

  cp -a "$ROOT/.next/standalone/." "$STAGE/"
  cp -a "$ROOT/.next/static" "$STAGE/.next/static"
  cp -a "$ROOT/public/_spa" "$ROOT/public/_spa-auth" "$ROOT/public/_spa-workbench" "$STAGE/public/"
  cp -a "$ROOT/packages/database/migrations" "$STAGE/migrations"
  cp "$ROOT/scripts/migrateServerDB/docker.cjs" "$STAGE/docker.cjs"
  cp "$ROOT/scripts/migrateServerDB/errorHint.js" "$STAGE/errorHint.js"
  cp -a "$ROOT/scripts/_shared/." "$STAGE/scripts/_shared/"
  cp "$ROOT/scripts/serverLauncher/startServer.js" "$STAGE/startServer.js"
  cp "$ROOT/scripts/docker/Dockerfile.staged" "$STAGE/Dockerfile"

  # docker.cjs requires drizzle-orm/node-postgres; Next standalone often omits it
  # because the app bundles ORM usage. Match root Dockerfile (copies drizzle-orm + pg).
  mkdir -p "$STAGE/node_modules"
  if [[ ! -e "$ROOT/node_modules/drizzle-orm" ]]; then
    echo "Error: node_modules/drizzle-orm missing — run pnpm install" >&2
    exit 1
  fi
  # -L: pnpm links into .pnpm; dereference so the image has real package files
  rm -rf "$STAGE/node_modules/drizzle-orm"
  cp -aL "$ROOT/node_modules/drizzle-orm" "$STAGE/node_modules/drizzle-orm"
  if [[ ! -e "$STAGE/node_modules/pg" ]]; then
    if [[ ! -e "$ROOT/node_modules/pg" ]]; then
      echo "Error: node_modules/pg missing — run pnpm install" >&2
      exit 1
    fi
    cp -aL "$ROOT/node_modules/pg" "$STAGE/node_modules/pg"
  fi

  docker build -t "$IMAGE" -t "aico/lobehub:$TAG" "$STAGE"

  echo "==> Verifying migration packaging in image"
  for path in /app/docker.cjs /app/errorHint.js /app/migrations /app/startServer.js /app/node_modules/drizzle-orm; do
    docker run --rm --entrypoint sh "$IMAGE" -c "test -e '$path'" || {
      echo "Error: image missing $path — auto-migrate would fail at boot" >&2
      exit 1
    }
  done
  docker run --rm --entrypoint node "$IMAGE" -e \
    "require('drizzle-orm/node-postgres'); require('drizzle-orm/node-postgres/migrator'); require('pg');" \
    || {
      echo "Error: image cannot resolve docker.cjs deps (drizzle-orm/pg)" >&2
      exit 1
    }

  echo "==> Image ready: $IMAGE (also tagged aico/lobehub:$TAG)"
fi

if [[ $START_IF_NEEDED -eq 1 ]]; then
  url="$(app_url)"
  if is_app_running; then
    echo "==> Already running ($CONTAINER_NAME)"
    echo "App: $url"
    echo "Tip: moz -i (info) · moz -r (restart) · moz -d (force redeploy) · moz -u (build+deploy)"
    exit 0
  fi
  echo "==> Not running — starting stack from $DEPLOY_DIR"
  stop_legacy_deploy
  compose_in_deploy_dir up -d
  verify_deploy_health
  exit 0
fi

if [[ $RESTART -eq 1 ]]; then
  url="$(app_url)"
  stop_legacy_deploy
  if is_app_running; then
    echo "==> Restarting containers from $DEPLOY_DIR"
    compose_in_deploy_dir restart
  else
    echo "==> Not running — starting stack from $DEPLOY_DIR"
    compose_in_deploy_dir up -d
  fi
  verify_deploy_health
  exit 0
fi

if [[ $DEPLOY -eq 1 ]]; then
  echo "==> Force-deploying from $DEPLOY_DIR"
  stop_legacy_deploy
  compose_in_deploy_dir up -d --force-recreate lobe
  verify_deploy_health
fi
