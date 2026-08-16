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
#   ./scripts/deploy-local.sh --restore F  # restore SQL dump into running Postgres

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/docker-compose/deploy"
# shellcheck source=moz-pgdata-guards.sh
source "$ROOT/scripts/moz-pgdata-guards.sh"
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
RESTORE_FILE=""

if [[ $# -eq 0 ]]; then
  START_IF_NEEDED=1
fi

# Pre-parse --restore FILE (needs the following argv; main loop is for-arg).
_MOZ_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore|-R)
      if [[ -z "${2:-}" || "$2" == -* ]]; then
        echo "Error: --restore requires a file path: moz --restore FILE.sql.gz" >&2
        exit 2
      fi
      RESTORE_FILE="$2"
      START_IF_NEEDED=0
      shift 2
      ;;
    --restore=*)
      RESTORE_FILE="${1#*=}"
      START_IF_NEEDED=0
      shift
      ;;
    *)
      _MOZ_ARGS+=("$1")
      shift
      ;;
  esac
done
set -- "${_MOZ_ARGS[@]+"${_MOZ_ARGS[@]}"}"

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
      echo "  moz --restore FILE.sql.gz" >&2
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
  --restore FILE.sql.gz Restore a SQL dump into running Postgres
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
                          Fingerprint + leftover bind copies after migrate.
                          Live Postgres/Redis/RustFS use named volumes
                          panachat_{postgres,redis,rustfs}_data
  PANACHAT_BACKUP_DIR     Backup root (default: ~/.local/share/panachat-backups)
  MOZ_SKIP_BACKUP=1       Skip automatic pre-deploy backup on -u / -d
  MOZ_ALLOW_EMPTY_DB=1    Allow starting Postgres when volume has no cluster
                          (intentional wipe / first bootstrap after delete)
  MOZ_ALLOW_DB_DRIFT=1    Allow redeploy when live DB fingerprint differs from
                          the last known good snapshot (users dropped, etc.)
  MOZ_ALLOW_TMPFS_PGDATA=1  Allow Postgres PGDATA on tmpfs (DANGEROUS — empty DB)
  MOZ_ALLOW_EMPTY_BACKUP=1  Allow moz -B when live users=0 but fingerprint>0,
                          or when Postgres is down but fingerprint has users
  AICO_CONTROL_PLANE_SERVICE_TOKEN   Shared product↔control-plane token
                          (moz generates a strong random token if missing/weak;
                           \`devtok\` is rejected)
  AICO_CONTROL_PLANE_PORT            Host port for control plane (default: 3020; bound to 127.0.0.1)
  OPENROUTER_MANAGEMENT_API_KEY      Set in repo .env — loaded only by control plane

Backups:
  moz -B                  Manual backup now (refuses tmpfs / empty-vs-fingerprint dumps)
  moz --restore FILE.sql.gz
  moz -u / moz -d         Auto pre-deploy backup (unless MOZ_SKIP_BACKUP=1)
  Daily cron:             ./scripts/panachat-backup.sh --install-cron

Reset Postgres (destructive):
  moz -k && docker volume rm panachat_postgres_data
  MOZ_ALLOW_EMPTY_DB=1 moz -d
  # optional: docker volume rm panachat_redis_data panachat_rustfs_data
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

run_panachat_restore() {
  local file="$1"
  local script="$ROOT/scripts/panachat-backup.sh"
  if [[ ! -x "$script" ]]; then
    if [[ -f "$script" ]]; then
      chmod +x "$script"
    else
      echo "Error: missing backup script: $script" >&2
      return 1
    fi
  fi
  "$script" --restore "$file"
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

# Stable Docker volumes (see docker-compose.aico.data.override.yml).
POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-panachat_postgres_data}"
REDIS_VOLUME_NAME="${REDIS_VOLUME_NAME:-panachat_redis_data}"
RUSTFS_VOLUME_NAME="${RUSTFS_VOLUME_NAME:-panachat_rustfs_data}"
REDIS_CONTAINER="${REDIS_CONTAINER:-lobe-redis}"
RUSTFS_CONTAINER="${RUSTFS_CONTAINER:-lobe-rustfs}"

ensure_panachat_data_env() {
  # Legacy postgres/redis/rustfs dirs kept as one-time migration sources.
  mkdir -p "$PANACHAT_DATA_DIR"/{postgres,redis,rustfs}

  if [[ -f "$DEPLOY_DIR/.env" ]] && ! grep -qE '^PANACHAT_DATA_DIR=' "$DEPLOY_DIR/.env"; then
    printf '\n# PanaChat runtime data (outside repo). Live data = named volumes; this dir keeps fingerprint + leftover binds\nPANACHAT_DATA_DIR=%s\n' \
      "$PANACHAT_DATA_DIR" >>"$DEPLOY_DIR/.env"
  fi
}

legacy_postgres_bind_dir() {
  echo "$PANACHAT_DATA_DIR/postgres"
}

postgres_volume_name() {
  echo "$POSTGRES_VOLUME_NAME"
}

redis_volume_name() {
  echo "$REDIS_VOLUME_NAME"
}

rustfs_volume_name() {
  echo "$RUSTFS_VOLUME_NAME"
}

# True if a Docker volume already has any non-dot files (used to skip re-copy).
volume_has_any_files() {
  local vol="$1"
  docker volume inspect "$vol" >/dev/null 2>&1 || return 1
  docker run --rm -v "$vol:/data:ro" alpine sh -c 'find /data -type f ! -path "*/.*" | grep -q .' 2>/dev/null
}

dir_has_any_files() {
  local dir="$1"
  [[ -n "$dir" && -d "$dir" ]] || return 1
  docker run --rm -v "$dir:/data:ro" alpine sh -c 'find /data -type f ! -path "*/.*" | grep -q .' 2>/dev/null
}

container_uses_named_volume() {
  local container="$1" dest="$2" vol="$3"
  local mount_type mount_name
  docker inspect "$container" >/dev/null 2>&1 || return 1
  mount_type="$(
    docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$dest\"}}{{.Type}}{{end}}{{end}}"       "$container" 2>/dev/null || true
  )"
  mount_name="$(
    docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$dest\"}}{{.Name}}{{end}}{{end}}"       "$container" 2>/dev/null || true
  )"
  [[ "$mount_type" == "volume" && "$mount_name" == "$vol" ]]
}

# One-time: copy a host bind directory into a named volume (never the reverse).
migrate_legacy_bind_dir_to_volume() {
  local vol="$1" legacy="$2" container="$3" label="$4"
  if volume_has_any_files "$vol"; then
    return 0
  fi
  if ! dir_has_any_files "$legacy"; then
    return 0
  fi

  if docker inspect "$container" >/dev/null 2>&1 \
    && [[ "$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)" == "running" ]]; then
    echo "==> Stopping $container for safe $label copy into volume"
    docker stop "$container" >/dev/null
  fi

  echo "==> Migrating $label into Docker volume $vol"
  echo "    Source (legacy bind): $legacy"
  docker volume inspect "$vol" >/dev/null 2>&1 || docker volume create "$vol" >/dev/null
  docker run --rm \
    -v "$legacy:/from:ro" \
    -v "$vol:/to" \
    alpine sh -c 'cp -a /from/. /to/'
  echo "==> $label migration complete (legacy bind left intact as cold copy)"
}

# One-time: copy an old Compose named volume into panachat_* (never the reverse).
migrate_legacy_compose_volume_to_volume() {
  local dest_vol="$1" source_vol="$2" container="$3" label="$4"
  if volume_has_any_files "$dest_vol"; then
    return 0
  fi
  if ! volume_has_any_files "$source_vol"; then
    return 0
  fi

  if docker inspect "$container" >/dev/null 2>&1 \
    && [[ "$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)" == "running" ]]; then
    echo "==> Stopping $container for safe $label copy into volume"
    docker stop "$container" >/dev/null
  fi

  echo "==> Migrating $label into Docker volume $dest_vol"
  echo "    Source (legacy Compose volume): $source_vol"
  docker volume inspect "$dest_vol" >/dev/null 2>&1 || docker volume create "$dest_vol" >/dev/null
  docker run --rm \
    -v "$source_vol:/from:ro" \
    -v "$dest_vol:/to" \
    alpine sh -c 'cp -a /from/. /to/'
  echo "==> $label migration complete (legacy Compose volume left intact)"
}

migrate_legacy_redis_bind_to_volume() {
  local dest
  dest="$(redis_volume_name)"
  # Prefer leftover host bind; then older Compose volume redis_data from base compose.
  migrate_legacy_bind_dir_to_volume "$dest" "$PANACHAT_DATA_DIR/redis" "$REDIS_CONTAINER" "Redis"
  migrate_legacy_compose_volume_to_volume "$dest" "redis_data" "$REDIS_CONTAINER" "Redis"
}

migrate_legacy_rustfs_bind_to_volume() {
  local dest
  dest="$(rustfs_volume_name)"
  migrate_legacy_bind_dir_to_volume "$dest" "$PANACHAT_DATA_DIR/rustfs" "$RUSTFS_CONTAINER" "RustFS"
  # Base compose historically named this rustfs-data (hyphen).
  migrate_legacy_compose_volume_to_volume "$dest" "rustfs-data" "$RUSTFS_CONTAINER" "RustFS"
}

ensure_service_named_volume_mount() {
  local container="$1" dest="$2" vol="$3" service="$4" migrate_fn="$5"
  "$migrate_fn"
  if container_uses_named_volume "$container" "$dest" "$vol"; then
    return 0
  fi
  echo "==> Recreating $service on named volume $vol"
  compose_in_deploy_dir up -d --force-recreate --no-deps "$service"
  wait_for_container "$container" 90 || true
}

ensure_redis_named_volume_mount() {
  ensure_service_named_volume_mount "$REDIS_CONTAINER" "/data" "$(redis_volume_name)" redis migrate_legacy_redis_bind_to_volume
}

ensure_rustfs_named_volume_mount() {
  ensure_service_named_volume_mount "$RUSTFS_CONTAINER" "/data" "$(rustfs_volume_name)" rustfs migrate_legacy_rustfs_bind_to_volume
}

# True if path-or-volume currently holds a Postgres cluster (PG_VERSION).
has_postgres_cluster_in_dir() {
  local dir="$1"
  [[ -n "$dir" ]] || return 1
  docker run --rm -v "$dir:/data:ro" alpine sh -c 'test -f /data/PG_VERSION' 2>/dev/null
}

has_postgres_cluster_in_volume() {
  local vol="$1"
  docker volume inspect "$vol" >/dev/null 2>&1 || return 1
  docker run --rm -v "$vol:/data:ro" alpine sh -c 'test -f /data/PG_VERSION' 2>/dev/null
}

has_postgres_cluster() {
  # Prefer named volume; fall back to legacy bind path (pre-migration).
  has_postgres_cluster_in_volume "$(postgres_volume_name)" \
    || has_postgres_cluster_in_dir "$(legacy_postgres_bind_dir)"
}

db_fingerprint_file() {
  echo "$PANACHAT_DATA_DIR/.moz-db-fingerprint"
}

# One-time: copy legacy host bind cluster into the named volume (never the reverse).
migrate_legacy_postgres_bind_to_volume() {
  local vol legacy
  vol="$(postgres_volume_name)"
  legacy="$(legacy_postgres_bind_dir)"

  if has_postgres_cluster_in_volume "$vol"; then
    return 0
  fi

  if ! has_postgres_cluster_in_dir "$legacy"; then
    return 0
  fi

  # Never copy a live PGDATA directory — stop Postgres first if it is using the bind.
  if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 \
    && [[ "$(docker inspect -f '{{.State.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" == "running" ]]; then
    echo "==> Stopping $POSTGRES_CONTAINER for safe PGDATA copy into volume"
    docker stop "$POSTGRES_CONTAINER" >/dev/null
  fi

  echo "==> Migrating Postgres cluster into Docker volume $vol"
  echo "    Source (legacy bind): $legacy"
  # Prefer Compose-created volume (labels) to avoid "not created by Compose" warnings.
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    compose_in_deploy_dir up --no-start postgresql >/dev/null || docker volume create "$vol" >/dev/null
  fi
  docker volume inspect "$vol" >/dev/null 2>&1 || docker volume create "$vol" >/dev/null
  docker run --rm \
    -v "$legacy:/from:ro" \
    -v "$vol:/to" \
    alpine sh -c 'cp -a /from/. /to/ && test -f /to/PG_VERSION'
  echo "==> Migration complete (legacy bind left intact as cold copy)"
}

# True when running lobe-postgres is already on the named volume (not a host bind / tmpfs).
postgres_uses_named_volume() {
  local mount_type mount_name
  docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || return 1
  mount_type="$(
    docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}{{end}}{{end}}' \
      "$POSTGRES_CONTAINER" 2>/dev/null || true
  )"
  mount_name="$(
    docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' \
      "$POSTGRES_CONTAINER" 2>/dev/null || true
  )"
  [[ "$mount_type" == "volume" && "$mount_name" == "$(postgres_volume_name)" ]]
}

# After Postgres is up: refuse tmpfs / missing PG_VERSION (the empty-DB failure mode).
assert_postgres_pgdata_healthy() {
  local fstype has_version

  if [[ "${MOZ_ALLOW_TMPFS_PGDATA:-}" == "1" ]]; then
    echo "==> Warning: MOZ_ALLOW_TMPFS_PGDATA=1 — skipping PGDATA filesystem check."
    return 0
  fi

  if ! docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 \
    || [[ "$(docker inspect -f '{{.State.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" != "running" ]]; then
    echo "Error: $POSTGRES_CONTAINER is not running — cannot verify PGDATA." >&2
    return 1
  fi

  fstype="$(
    docker exec "$POSTGRES_CONTAINER" sh -c 'df -T /var/lib/postgresql/data 2>/dev/null | awk "NR==2{print \$2}"' \
      2>/dev/null || echo unknown
  )"
  has_version="$(
    docker exec "$POSTGRES_CONTAINER" sh -c 'test -f /var/lib/postgresql/data/PG_VERSION && echo yes || echo no' \
      2>/dev/null || echo no
  )"

  if moz_is_tmpfs_pgdata "$fstype"; then
    cat >&2 <<EOF
Error: Postgres PGDATA is on $fstype (empty RAM disk) — refusing to continue.

  This is the Docker Desktop + WSL2 bind-mount bug (or a broken volume mount).
  An empty PGDATA would make Postgres initdb and look like all users were deleted.

  Fix:
    moz -k
    # restart Docker Desktop if needed
    moz -d

  Override only if intentional:
    MOZ_ALLOW_TMPFS_PGDATA=1 moz -d
EOF
    return 1
  fi

  if [[ "$has_version" != "yes" ]]; then
    cat >&2 <<EOF
Error: Postgres PGDATA has no PG_VERSION inside the container (initdb risk).

  Volume: $(postgres_volume_name)
  FS type: $fstype

  Recover from backup (moz -B dumps) or migrate legacy bind data, then redeploy.
EOF
    return 1
  fi

  if ! postgres_uses_named_volume; then
    echo "==> Warning: Postgres is running but not on volume $(postgres_volume_name) (mount may be stale)."
    echo "    Run: moz -k && moz -d  to recreate postgresql with the named volume."
  fi

  echo "==> Postgres PGDATA ok (fs=$fstype, volume=$(postgres_volume_name))"
}

# Bring Postgres up on the named volume; recreate the container if still on a bind.
ensure_postgres_named_volume_mount() {
  migrate_legacy_postgres_bind_to_volume

  # Always gate empty volume vs fingerprint — even when already on the named volume
  # (early return used to skip this and allow a later empty initdb path).
  # First install (no fingerprint) still proceeds; MOZ_ALLOW_EMPTY_DB=1 for intentional wipe.
  assert_postgres_cluster_safe

  if postgres_uses_named_volume; then
    return 0
  fi

  echo "==> Recreating postgresql on named volume $(postgres_volume_name)"
  compose_in_deploy_dir up -d --force-recreate --no-deps postgresql
  wait_for_container "$POSTGRES_CONTAINER" 90
  # Wait until healthy / accepting connections
  local elapsed=0
  while (( elapsed < 60 )); do
    if docker exec "$POSTGRES_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  assert_postgres_pgdata_healthy
}

# Copy leftover host binds → named volumes, then recreate services still on binds/tmpfs.
# Must run before pre-deploy backup and fingerprint so moz -u never dumps/compares a RAM DB.
prepare_runtime_volumes_for_deploy() {
  migrate_legacy_deploy_data
  ensure_postgres_named_volume_mount
  ensure_redis_named_volume_mount
  ensure_rustfs_named_volume_mount
}

prepare_postgres_for_deploy() {
  prepare_runtime_volumes_for_deploy
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
  local users admins migrations has_cluster=0
  local stats vol
  vol="$(postgres_volume_name)"
  if has_postgres_cluster; then
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
postgres_volume=$vol
postgres_dir=$(legacy_postgres_bind_dir)
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

# Abort if starting Postgres would initdb on an empty volume after we previously had data.
assert_postgres_cluster_safe() {
  local fingerprint_users fingerprint_cluster

  if has_postgres_cluster; then
    return 0
  fi

  fingerprint_cluster="$(load_fingerprint_value has_cluster || true)"
  fingerprint_users="$(load_fingerprint_value users || true)"

  if [[ "${MOZ_ALLOW_EMPTY_DB:-}" == "1" ]]; then
    echo "==> Warning: Postgres volume/data has no cluster (PG_VERSION missing)."
    echo "    MOZ_ALLOW_EMPTY_DB=1 set — allowing empty bootstrap (initdb will wipe/create)."
    return 0
  fi

  if [[ "$fingerprint_cluster" == "1" ]] \
    || [[ "$fingerprint_users" =~ ^[0-9]+$ && "$fingerprint_users" -gt 0 ]]; then
    cat >&2 <<EOF
Error: refusing to start/redeploy — Postgres volume is EMPTY but moz
previously recorded a real cluster here.

  Data dir:     $PANACHAT_DATA_DIR
  Volume:       $(postgres_volume_name)
  Legacy bind:  $(legacy_postgres_bind_dir)
  Fingerprint:  $(db_fingerprint_file)
  Last users:   ${fingerprint_users:-unknown}

Starting the stack now would run initdb and permanently lose the previous DB.

Recover: ensure volume has data (moz migrates from legacy bind automatically),
restore a SQL dump, or intentionally reset with:
  moz -k && docker volume rm $(postgres_volume_name)
  MOZ_ALLOW_EMPTY_DB=1 moz -d
EOF
    exit 1
  fi

  # First-time install (no fingerprint / never had users): allow empty cluster.
  echo "==> Postgres volume has no cluster yet (first bootstrap)."
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
  # Older installs kept PGDATA under docker-compose/deploy/data — copy into named volume.
  local legacy="$DEPLOY_DIR/data"
  local vol
  vol="$(postgres_volume_name)"

  migrate_legacy_postgres_bind_to_volume
  migrate_legacy_redis_bind_to_volume
  migrate_legacy_rustfs_bind_to_volume

  if has_postgres_cluster_in_volume "$vol"; then
    return 0
  fi

  if ! has_postgres_cluster_in_dir "$legacy"; then
    return 0
  fi

  echo "==> Migrating postgres data from $legacy to volume $vol"
  docker volume create "$vol" >/dev/null
  docker run --rm \
    -v "$legacy:/from:ro" \
    -v "$vol:/to" \
    alpine sh -c 'cp -a /from/. /to/ && test -f /to/PG_VERSION'
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

  # Gate empty/tmpfs PGDATA before treating the app as healthy.
  wait_for_container "$POSTGRES_CONTAINER" 90 || return 1
  assert_postgres_pgdata_healthy || return 1

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
  local pg_fs pg_mount redis_mount rustfs_mount
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
    pg_fs="$(
      docker exec "$POSTGRES_CONTAINER" sh -c 'df -T /var/lib/postgresql/data 2>/dev/null | awk "NR==2{print \$2}"' \
        2>/dev/null || echo "?"
    )"
    pg_mount="$(
      docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}' \
        "$POSTGRES_CONTAINER" 2>/dev/null || echo "?"
    )"
    printf "PGDATA:        fs=%s mount=%s\n" "$pg_fs" "$pg_mount"
    if moz_is_tmpfs_pgdata "$pg_fs"; then
      echo "  ⚠️  PGDATA on tmpfs — empty-DB risk (moz -k && moz -d)"
      exit_code=1
    fi
    redis_mount="$(
      docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}' \
        "$REDIS_CONTAINER" 2>/dev/null || echo "?"
    )"
    rustfs_mount="$(
      docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}' \
        "$RUSTFS_CONTAINER" 2>/dev/null || echo "?"
    )"
    printf "Redis data:    mount=%s (expect volume:%s)\n" "$redis_mount" "$(redis_volume_name)"
    printf "RustFS data:   mount=%s (expect volume:%s)\n" "$rustfs_mount" "$(rustfs_volume_name)"
    if [[ "$redis_mount" != "volume:$(redis_volume_name)" ]]; then
      echo "  ⚠️  Redis not on named volume — run: moz -k && moz -d"
      exit_code=1
    fi
    if [[ "$rustfs_mount" != "volume:$(rustfs_volume_name)" ]]; then
      echo "  ⚠️  RustFS not on named volume — run: moz -k && moz -d"
      exit_code=1
    fi
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
    if ! has_postgres_cluster; then
      echo "Postgres data: NO cluster on volume $(postgres_volume_name) (initdb risk)"
      exit_code=1
    else
      printf "Postgres data: cluster present on volume %s\n" "$(postgres_volume_name)"
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

if [[ -n "$RESTORE_FILE" ]]; then
  load_panachat_data_dir
  run_panachat_restore "$RESTORE_FILE"
  exit 0
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

# Remount Postgres onto the named volume BEFORE backup/fingerprint/build.
# Otherwise moz -u can dump a Docker Desktop tmpfs empty DB (0 users) and then
# refuse deploy because live users dropped vs fingerprint.
if [[ $DEPLOY -eq 1 ]]; then
  load_panachat_data_dir
  echo "==> Preparing named volumes (migrate leftover binds if needed)"
  prepare_runtime_volumes_for_deploy
  if [[ "${MOZ_SKIP_BACKUP:-}" != "1" ]]; then
    echo "==> Pre-deploy backup"
    run_panachat_backup pre-deploy || {
      echo "Error: pre-deploy backup failed. Fix the backup error, or set MOZ_SKIP_BACKUP=1 to continue." >&2
      exit 1
    }
  fi
  assert_db_fingerprint_matches
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
  prepare_runtime_volumes_for_deploy
  assert_db_fingerprint_matches
  compose_in_deploy_dir up -d
  verify_deploy_health
  exit 0
fi

if [[ $RESTART -eq 1 ]]; then
  url="$(app_url)"
  [[ -f "$ROOT/apps/aico-control-plane/dist/standalone.js" ]] || ensure_control_plane_build
  prepare_runtime_volumes_for_deploy
  assert_db_fingerprint_matches
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
  [[ -f "$ROOT/apps/aico-control-plane/dist/standalone.js" ]] || ensure_control_plane_build
  # Postgres was already migrated/remounted/fingerprinted before the build.
  compose_in_deploy_dir up -d --force-recreate lobe aico-control-plane
  ensure_postgres_named_volume_mount
  verify_deploy_health
fi
