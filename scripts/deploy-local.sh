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
#   ./scripts/deploy-local.sh -B|--backup  # DB + uploads backup (no deploy)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/docker-compose/deploy"
PANACHAT_DATA_DIR="${PANACHAT_DATA_DIR:-$HOME/.local/share/panachat-data}"
IMAGE="aico/lobehub:local"
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)"
CONTAINER_NAME="lobehub"
POSTGRES_CONTAINER="lobe-postgres"
STAGE=""

BUILD=0
DEPLOY=0
STOP=0
STATUS=0
RESTART=0
START_IF_NEEDED=0
BACKUP_ONLY=0

if [[ $# -eq 0 ]]; then
  START_IF_NEEDED=1
fi

for arg in "$@"; do
  case "$arg" in
    -u|--up|--ship|up) BUILD=1; DEPLOY=1; START_IF_NEEDED=0 ;;
    -d|--deploy|--deploy-only|deploy) DEPLOY=1; START_IF_NEEDED=0 ;;
    -b|--build|--build-only|build) BUILD=1; DEPLOY=0; START_IF_NEEDED=0 ;;
    -B|--backup|backup) BACKUP_ONLY=1; START_IF_NEEDED=0 ;;
    -r|--restart|restart) RESTART=1; START_IF_NEEDED=0 ;;
    -i|--info|info|status|--status) STATUS=1; BUILD=0; DEPLOY=0; STOP=0; RESTART=0; START_IF_NEEDED=0 ;;
    -k|--kill|kill|stop|--stop|--down) STOP=1; BUILD=0; DEPLOY=0; RESTART=0; START_IF_NEEDED=0 ;;
    -s|-S)
      echo "Error: $arg removed. Use distinct letters:" >&2
      echo "  moz -i   info / status" >&2
      echo "  moz -k   kill / stop containers" >&2
      echo "  moz -r   restart containers" >&2
      echo "  moz -B   backup DB + uploads" >&2
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
Also builds and starts the Aico control plane (SPA + API on port 3020).

Options (each has a distinct one-letter flag):
  (default)             Start stack only if not already running
  -u, --up, up          Build from source, then force-deploy
  -d, --deploy, deploy  Force redeploy / recreate (no build)
  -b, --build, build    Build and tag the image only (skip deploy)
  -B, --backup, backup  Backup Postgres + RustFS (no deploy)
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
  PANACHAT_DATA_DIR       Host data root (default: ~/.local/share/panachat-data)
  PANACHAT_BACKUP_DIR     Backup root (default: ~/.local/share/panachat-backups)
  MOZ_SKIP_BACKUP=1       Skip automatic pre-deploy backup on -u / -d
  MOZ_ALLOW_EMPTY_DB=1    Allow starting Postgres when data dir has no cluster
                          (intentional wipe / first bootstrap after delete)
  MOZ_ALLOW_DB_DRIFT=1    Allow redeploy when live DB fingerprint differs from
                          the last known good snapshot (users dropped, etc.)
  AICO_CONTROL_PLANE_SERVICE_TOKEN   Shared product↔control-plane token
                          (moz generates a strong random token if missing/weak;
                           `devtok` is rejected)
  AICO_CONTROL_PLANE_PORT            Host port for control plane (default: 3020; bound to 127.0.0.1)
  OPENROUTER_MANAGEMENT_API_KEY      Set in repo .env — loaded only by control plane

Backups:
  moz -B                  Manual backup now
  moz -u / moz -d         Auto pre-deploy backup (unless MOZ_SKIP_BACKUP=1)
  Daily cron:             ./scripts/panachat-backup.sh --install-cron
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

run_panachat_backup() {
  local reason="${1:-manual}"
  local script="$ROOT/scripts/panachat-backup.sh"
  if [[ ! -x "$script" ]]; then
    if [[ -f "$script" ]]; then
      chmod +x "$script"
    else
      echo "Error: missing backup script: $script" >&2
      return 1
    fi
  fi
  "$script" --reason "$reason"
}

app_url() {
  local app_port
  app_port="$(grep -E '^LOBE_PORT=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  echo "http://127.0.0.1:${app_port:-3210}"
}

is_app_running() {
  [[ "$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo missing)" == "running" ]]
}

load_panachat_data_dir() {
  if [[ -f "$DEPLOY_DIR/.env" ]]; then
    local from_env
    from_env="$(grep -E '^PANACHAT_DATA_DIR=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
    if [[ -n "$from_env" ]]; then
      PANACHAT_DATA_DIR="$from_env"
    fi
    from_env="$(grep -E '^PANACHAT_BACKUP_DIR=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
    if [[ -n "$from_env" ]]; then
      PANACHAT_BACKUP_DIR="$from_env"
      export PANACHAT_BACKUP_DIR
    fi
  fi
  : "${PANACHAT_BACKUP_DIR:=$HOME/.local/share/panachat-backups}"
  export PANACHAT_BACKUP_DIR
}

ensure_panachat_data_env() {
  mkdir -p "$PANACHAT_DATA_DIR"/{postgres,redis,rustfs}

  if [[ -f "$DEPLOY_DIR/.env" ]] && ! grep -qE '^PANACHAT_DATA_DIR=' "$DEPLOY_DIR/.env"; then
    printf '\n# PanaChat runtime data (outside repo). Subdirs: postgres/, redis/, rustfs/\nPANACHAT_DATA_DIR=%s\n' \
      "$PANACHAT_DATA_DIR" >>"$DEPLOY_DIR/.env"
  fi
}

has_postgres_cluster() {
  local dir="$1"
  docker run --rm -v "$dir:/data:ro" alpine sh -c 'test -f /data/PG_VERSION' 2>/dev/null
}

postgres_data_dir() {
  echo "$PANACHAT_DATA_DIR/postgres"
}

db_fingerprint_file() {
  echo "$PANACHAT_DATA_DIR/.moz-db-fingerprint"
}

# Read live DB stats when postgres is up. Prints: users|admins|migrations
# Uses "?" for any field that cannot be read.
read_live_db_stats() {
  local users="?" admins="?" migrations="?"
  if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 \
    && [[ "$(docker inspect -f '{{.State.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" == "running" ]]; then
    users="$(
      docker exec "$POSTGRES_CONTAINER" psql -U postgres -d lobechat -Atc \
        "SELECT count(*) FROM users;" 2>/dev/null || echo "?"
    )"
    admins="$(
      docker exec "$POSTGRES_CONTAINER" psql -U postgres -d lobechat -Atc \
        "SELECT count(*) FROM platform_admins;" 2>/dev/null || echo "?"
    )"
    migrations="$(
      docker exec "$POSTGRES_CONTAINER" psql -U postgres -d lobechat -Atc \
        "SELECT count(*) FROM drizzle.__drizzle_migrations;" 2>/dev/null || echo "?"
    )"
  fi
  printf '%s|%s|%s\n' "$users" "$admins" "$migrations"
}

# Persist a fingerprint after a healthy deploy so later moz runs can detect wipe/drift.
save_db_fingerprint() {
  local users admins migrations has_cluster=0 pgdir
  local stats
  pgdir="$(postgres_data_dir)"
  if has_postgres_cluster "$pgdir"; then
    has_cluster=1
  fi
  stats="$(read_live_db_stats)"
  IFS='|' read -r users admins migrations <<<"$stats"

  mkdir -p "$PANACHAT_DATA_DIR"
  cat >"$(db_fingerprint_file)" <<EOF
# Written by moz after a healthy deploy. Do not edit while debugging data loss.
version=1
saved_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
data_dir=$PANACHAT_DATA_DIR
postgres_dir=$pgdir
has_cluster=$has_cluster
users=${users}
admins=${admins}
migrations=${migrations}
EOF
}

load_fingerprint_value() {
  local key="$1"
  local file
  file="$(db_fingerprint_file)"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2-
}

# Abort if starting Postgres would initdb on an empty dir after we previously had data.
assert_postgres_cluster_safe() {
  local pgdir fingerprint_users fingerprint_cluster
  pgdir="$(postgres_data_dir)"

  if has_postgres_cluster "$pgdir"; then
    return 0
  fi

  fingerprint_cluster="$(load_fingerprint_value has_cluster || true)"
  fingerprint_users="$(load_fingerprint_value users || true)"

  if [[ "${MOZ_ALLOW_EMPTY_DB:-}" == "1" ]]; then
    echo "==> Warning: postgres data dir has no cluster (PG_VERSION missing)."
    echo "    MOZ_ALLOW_EMPTY_DB=1 set — allowing empty bootstrap (initdb will wipe/create)."
    return 0
  fi

  if [[ "$fingerprint_cluster" == "1" ]] \
    || [[ "$fingerprint_users" =~ ^[0-9]+$ && "$fingerprint_users" -gt 0 ]]; then
    cat >&2 <<EOF
Error: refusing to start/redeploy — Postgres data directory is EMPTY but moz
previously recorded a real cluster here.

  Data dir:     $PANACHAT_DATA_DIR
  Postgres dir: $pgdir
  Fingerprint:  $(db_fingerprint_file)
  Last users:   ${fingerprint_users:-unknown}

Starting the stack now would run initdb and permanently lose the previous DB.

Recover the postgres folder from backup, or intentionally reset with:
  MOZ_ALLOW_EMPTY_DB=1 moz -d
EOF
    exit 1
  fi

  # First-time install (no fingerprint / never had users): allow empty cluster.
  echo "==> Postgres data dir has no cluster yet (first bootstrap)."
}

# Abort redeploy when live DB no longer matches the last known fingerprint.
assert_db_fingerprint_matches() {
  local fp_dir fp_users fp_admins fp_migrations
  local live_users live_admins live_migrations
  local stats

  if [[ "${MOZ_ALLOW_DB_DRIFT:-}" == "1" ]]; then
    echo "==> Warning: MOZ_ALLOW_DB_DRIFT=1 — skipping DB fingerprint check."
    return 0
  fi

  [[ -f "$(db_fingerprint_file)" ]] || return 0

  fp_dir="$(load_fingerprint_value data_dir || true)"
  fp_users="$(load_fingerprint_value users || true)"
  fp_admins="$(load_fingerprint_value admins || true)"
  fp_migrations="$(load_fingerprint_value migrations || true)"

  if [[ -n "$fp_dir" && "$fp_dir" != "$PANACHAT_DATA_DIR" ]]; then
    cat >&2 <<EOF
Error: refusing to redeploy — PANACHAT_DATA_DIR changed since last healthy deploy.

  Fingerprint data dir: $fp_dir
  Current data dir:     $PANACHAT_DATA_DIR

Fix the path in docker-compose/deploy/.env, or override with:
  MOZ_ALLOW_DB_DRIFT=1 moz -d
EOF
    exit 1
  fi

  assert_postgres_cluster_safe

  # Only compare live counts when postgres is already running (redeploy/restart).
  if ! docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 \
    || [[ "$(docker inspect -f '{{.State.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" != "running" ]]; then
    return 0
  fi

  stats="$(read_live_db_stats)"
  IFS='|' read -r live_users live_admins live_migrations <<<"$stats"

  if [[ "$fp_users" =~ ^[0-9]+$ && "$live_users" =~ ^[0-9]+$ ]]; then
    if (( live_users < fp_users )); then
      cat >&2 <<EOF
Error: refusing to redeploy — live user count DROPPED vs last known good DB.

  Fingerprint users: $fp_users
  Live users:        $live_users
  Fingerprint file:  $(db_fingerprint_file)

This usually means Postgres was re-initialized (empty data dir → initdb) or
data was restored from the wrong volume. Investigate before redeploying.

Override only if intentional:
  MOZ_ALLOW_DB_DRIFT=1 moz -d
EOF
      exit 1
    fi
  fi

  if [[ "$fp_admins" =~ ^[0-9]+$ && "$live_admins" =~ ^[0-9]+$ ]]; then
    if (( fp_admins > 0 && live_admins < fp_admins )); then
      cat >&2 <<EOF
Error: refusing to redeploy — platform admin count DROPPED vs fingerprint.

  Fingerprint admins: $fp_admins
  Live admins:        $live_admins

Override only if intentional:
  MOZ_ALLOW_DB_DRIFT=1 moz -d
EOF
      exit 1
    fi
  fi

  if [[ "$fp_migrations" =~ ^[0-9]+$ && "$live_migrations" =~ ^[0-9]+$ ]]; then
    # Migrations should never shrink on a healthy volume; shrink ⇒ different/empty cluster.
    if (( live_migrations + 5 < fp_migrations )); then
      cat >&2 <<EOF
Error: refusing to redeploy — migration count looks like a different/empty DB.

  Fingerprint migrations: $fp_migrations
  Live migrations:        $live_migrations

Override only if intentional:
  MOZ_ALLOW_DB_DRIFT=1 moz -d
EOF
      exit 1
    fi
  fi
}

migrate_legacy_deploy_data() {
  local legacy="$DEPLOY_DIR/data"
  local target="$PANACHAT_DATA_DIR/postgres"

  if has_postgres_cluster "$target"; then
    return 0
  fi

  if ! has_postgres_cluster "$legacy"; then
    return 0
  fi

  echo "==> Migrating postgres data from $legacy to $target"
  mkdir -p "$target"
  docker run --rm \
    -v "$legacy:/from:ro" \
    -v "$target:/to" \
    alpine sh -c 'cp -a /from/. /to/'
}

compose_in_deploy_dir() {
  (
    cd "$DEPLOY_DIR"
    docker compose \
      --env-file ../../.env \
      --env-file .env \
      -f docker-compose.yml \
      -f docker-compose.aico.override.yml \
      -f docker-compose.aico.data.override.yml \
      -f docker-compose.aico.control-plane.override.yml \
      "$@"
  )
}

CONTROL_PLANE_CONTAINER="aico-control-plane"

# Upsert KEY=VALUE in an env file (create file if missing).
upsert_env_kv() {
  local file="$1"
  local key="$2"
  local value="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    # portable-ish in-place replace
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

# Strong shared token required — never use the old `devtok` placeholder.
ensure_control_plane_service_token() {
  local root_env="$ROOT/.env"
  local deploy_env="$DEPLOY_DIR/.env"
  local tok=""

  tok="$(grep -E '^AICO_CONTROL_PLANE_SERVICE_TOKEN=' "$root_env" 2>/dev/null | cut -d= -f2- || true)"
  if [[ -z "$tok" ]]; then
    tok="$(grep -E '^AICO_CONTROL_PLANE_SERVICE_TOKEN=' "$deploy_env" 2>/dev/null | cut -d= -f2- || true)"
  fi

  if [[ -z "$tok" || "$tok" == "devtok" || ${#tok} -lt 24 ]]; then
    tok="$(openssl rand -hex 32)"
    echo "==> Generated AICO_CONTROL_PLANE_SERVICE_TOKEN (was missing/weak)"
    upsert_env_kv "$root_env" "AICO_CONTROL_PLANE_SERVICE_TOKEN" "$tok"
    upsert_env_kv "$deploy_env" "AICO_CONTROL_PLANE_SERVICE_TOKEN" "$tok"
  else
    # Keep deploy/.env in sync so compose --env-file sees it
    upsert_env_kv "$deploy_env" "AICO_CONTROL_PLANE_SERVICE_TOKEN" "$tok"
  fi

  export AICO_CONTROL_PLANE_SERVICE_TOKEN="$tok"
}

ensure_control_plane_build() {
  echo "==> Building control-plane SPA + API"
  cd "$ROOT"
  bun run build:spa:control-plane
  pnpm --filter @aico/control-plane build
  [[ -f "$ROOT/apps/aico-control-plane/dist/standalone.js" ]] || {
    echo "Error: missing apps/aico-control-plane/dist/standalone.js after build" >&2
    exit 1
  }
  [[ -f "$ROOT/apps/aico-control-plane/web/spa/index.html" ]] || {
    echo "Error: missing apps/aico-control-plane/web/spa/index.html after SPA build" >&2
    exit 1
  }
}

wait_for_control_plane() {
  local port timeout elapsed code
  port="$(grep -E '^AICO_CONTROL_PLANE_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- || true)"
  port="${port:-3020}"
  timeout="${1:-90}"
  elapsed=0
  code="000"

  echo "==> Waiting for control plane at http://127.0.0.1:${port}/health ..."
  while (( elapsed < timeout )); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${port}/health" 2>/dev/null || echo "000")"
    if [[ "$code" == "200" ]]; then
      echo "==> Control plane healthy"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "Error: control plane not ready (last HTTP $code)" >&2
  docker logs "$CONTROL_PLANE_CONTAINER" 2>&1 | tail -30 >&2 || true
  return 1
}

verify_deploy_health() {
  local url migrate_line cp_port
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

  wait_for_container "$CONTROL_PLANE_CONTAINER" 90 || return 1
  wait_for_control_plane 90 || return 1

  save_db_fingerprint
  echo "==> DB fingerprint saved ($(db_fingerprint_file))"

  docker logs "$CONTAINER_NAME" 2>&1 | tail -8
  echo ""
  echo "App: $url"
  cp_port="$(grep -E '^AICO_CONTROL_PLANE_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- || true)"
  echo "Control plane: http://127.0.0.1:${cp_port:-3020}"
}

container_state() {
  local name="$1"
  docker inspect -f '{{.State.Status}}{{if .State.Health}} ({{.State.Health.Status}}){{end}}' "$name" 2>/dev/null || echo "missing"
}

show_status() {
  local app_port app_url http_code image_id image_created
  local expected_migrations applied_migrations migrate_log docker_cjs migrations_dir
  local user_count admin_count exit_code=0
  local fp_users
  local cp_port cp_code

  app_port="$(grep -E '^LOBE_PORT=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  app_url="http://127.0.0.1:${app_port:-3210}"

  echo "Aico deploy status"
  echo "------------------"
  printf "App URL:     %s\n" "$app_url"
  printf "Data dir:    %s\n" "$PANACHAT_DATA_DIR"
  printf "Backup dir:  %s\n" "${PANACHAT_BACKUP_DIR:-$HOME/.local/share/panachat-backups}"
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
  printf "  %-20s %s\n" "lobehub" "$(container_state lobehub)"
  printf "  %-20s %s\n" "aico-control-plane" "$(container_state aico-control-plane)"
  printf "  %-20s %s\n" "lobe-postgres" "$(container_state lobe-postgres)"
  printf "  %-20s %s\n" "lobe-redis" "$(container_state lobe-redis)"
  printf "  %-20s %s\n" "lobe-rustfs" "$(container_state lobe-rustfs)"

  http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$app_url/signin" 2>/dev/null || echo "000")"
  printf "\nHTTP /signin: %s\n" "$http_code"
  if [[ "$http_code" != "200" && "$http_code" != "302" ]]; then
    exit_code=1
  fi

  cp_port="$(grep -E '^AICO_CONTROL_PLANE_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- || true)"
  cp_port="${cp_port:-3020}"
  cp_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${cp_port}/health" 2>/dev/null || echo "000")"
  printf "Control plane: http://127.0.0.1:%s  /health=%s\n" "$cp_port" "$cp_code"
  if [[ "$cp_code" != "200" ]]; then
    exit_code=1
  fi
  if [[ ! -f "$ROOT/apps/aico-control-plane/dist/standalone.js" ]] \
    || [[ ! -f "$ROOT/apps/aico-control-plane/web/spa/index.html" ]]; then
    echo "  (missing control-plane build — run: moz -b / moz -u)"
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
    if [[ -f "$(db_fingerprint_file)" ]]; then
      printf "DB fingerprint: users=%s admins=%s migrations=%s (saved %s)\n" \
        "$(load_fingerprint_value users || echo '?')" \
        "$(load_fingerprint_value admins || echo '?')" \
        "$(load_fingerprint_value migrations || echo '?')" \
        "$(load_fingerprint_value saved_at || echo '?')"
    else
      echo "DB fingerprint: none yet (will be written after next healthy moz -d/-u/-r)"
    fi
    if [[ "$applied_migrations" =~ ^[0-9]+$ && "$expected_migrations" =~ ^[0-9]+$ ]]; then
      if (( applied_migrations < expected_migrations )); then
        echo "  ⚠️  DB behind repo — run: bun run db:migrate   (or moz -u after packaging fix)"
        exit_code=1
      fi
    fi
    if [[ -f "$(db_fingerprint_file)" ]]; then
      fp_users="$(load_fingerprint_value users || true)"
      if [[ "$fp_users" =~ ^[0-9]+$ && "$user_count" =~ ^[0-9]+$ ]] && (( user_count < fp_users )); then
        echo "  ⚠️  Live users ($user_count) < fingerprint ($fp_users) — possible DB wipe"
        exit_code=1
      fi
    fi
  else
    echo ""
    echo "DB:            postgres not running"
    if ! has_postgres_cluster "$(postgres_data_dir)"; then
      echo "Postgres data: NO cluster (empty dir — initdb risk)"
      exit_code=1
    fi
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

if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  echo "Missing $DEPLOY_DIR/.env — copy from docker-compose/deploy/.env.example.aico and configure infra secrets." >&2
  exit 1
fi

load_panachat_data_dir
ensure_panachat_data_env
ensure_control_plane_service_token

if [[ $STATUS -eq 1 ]]; then
  set +e
  show_status
  exit $?
fi

if [[ $BACKUP_ONLY -eq 1 ]]; then
  load_panachat_data_dir
  run_panachat_backup manual
  exit 0
fi

if [[ $STOP -eq 1 ]]; then
  echo "==> Stopping deployment from $DEPLOY_DIR"
  compose_in_deploy_dir down
  echo "==> Deployment stopped"
  exit 0
fi

# Pre-deploy safety net: dump before rebuild/recreate can touch data.
if [[ $DEPLOY -eq 1 && "${MOZ_SKIP_BACKUP:-}" != "1" ]]; then
  load_panachat_data_dir
  echo "==> Pre-deploy backup"
  run_panachat_backup pre-deploy || {
    echo "Error: pre-deploy backup failed. Fix the backup error, or set MOZ_SKIP_BACKUP=1 to continue." >&2
    exit 1
  }
fi

if [[ $BUILD -eq 1 ]]; then
  echo "==> Building app (DOCKER=true bun run build:docker)"
  cd "$ROOT"
  DOCKER=true bun run build:docker
  ensure_control_plane_build

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
    "$ROOT/apps/aico-control-plane/dist/standalone.js"
    "$ROOT/apps/aico-control-plane/web/spa/index.html"
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
  [[ -f "$ROOT/apps/aico-control-plane/dist/standalone.js" ]] || ensure_control_plane_build
  migrate_legacy_deploy_data
  assert_db_fingerprint_matches
  compose_in_deploy_dir up -d
  verify_deploy_health
  exit 0
fi

if [[ $RESTART -eq 1 ]]; then
  url="$(app_url)"
  assert_db_fingerprint_matches
  [[ -f "$ROOT/apps/aico-control-plane/dist/standalone.js" ]] || ensure_control_plane_build
  if is_app_running; then
    echo "==> Restarting containers from $DEPLOY_DIR"
    compose_in_deploy_dir restart
  else
    echo "==> Not running — starting stack from $DEPLOY_DIR"
    migrate_legacy_deploy_data
    assert_db_fingerprint_matches
    compose_in_deploy_dir up -d
  fi
  verify_deploy_health
  exit 0
fi

if [[ $DEPLOY -eq 1 ]]; then
  echo "==> Force-deploying from $DEPLOY_DIR"
  [[ -f "$ROOT/apps/aico-control-plane/dist/standalone.js" ]] || ensure_control_plane_build
  migrate_legacy_deploy_data
  assert_db_fingerprint_matches
  compose_in_deploy_dir up -d --force-recreate lobe aico-control-plane
  verify_deploy_health
fi
