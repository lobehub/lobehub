#!/usr/bin/env bash
# Backup / restore PanaChat / Aico deploy data (Postgres dump + RustFS uploads).
#
# Postgres/Redis/RustFS live in Docker named volumes (moz local deploys).
# Dumps go through `docker exec … pg_dump` and a volume tar for RustFS.
#
# Usage:
#   ./scripts/panachat-backup.sh                  # manual backup
#   ./scripts/panachat-backup.sh --reason daily
#   ./scripts/panachat-backup.sh --reason pre-deploy
#   ./scripts/panachat-backup.sh --restore FILE.sql.gz
#   ./scripts/panachat-backup.sh --install-cron    # daily 03:00 user crontab
#   ./scripts/panachat-backup.sh --list
#   ./scripts/panachat-backup.sh --prune-only
#
# Env (optional; also read from docker-compose/deploy/.env):
#   PANACHAT_DATA_DIR      default ~/.local/share/panachat-data
#   PANACHAT_BACKUP_DIR    default ~/.local/share/panachat-backups
#   LOBE_DB_NAME           default lobechat
#   POSTGRES_CONTAINER     default lobe-postgres
#   POSTGRES_VOLUME_NAME   default panachat_postgres_data
#   RUSTFS_VOLUME_NAME     default panachat_rustfs_data
#   PANACHAT_KEEP_DAILY_DAYS=14
#   PANACHAT_KEEP_WEEKLY_DAYS=56
#   PANACHAT_KEEP_MONTHLY_DAYS=365
#   PANACHAT_KEEP_PREDEPLOY=5
#   MOZ_SKIP_BACKUP=1              no-op exit 0 (used by moz)
#   MOZ_ALLOW_EMPTY_BACKUP=1       allow dump when live users=0 but fingerprint>0,
#                                  or when Postgres is down but fingerprint has users
#   MOZ_ALLOW_TMPFS_PGDATA=1       allow dump while PGDATA is tmpfs (dangerous)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/docker-compose/deploy"
# shellcheck source=moz-pgdata-guards.sh
source "$ROOT/scripts/moz-pgdata-guards.sh"

PANACHAT_DATA_DIR="${PANACHAT_DATA_DIR:-$HOME/.local/share/panachat-data}"
PANACHAT_BACKUP_DIR="${PANACHAT_BACKUP_DIR:-$HOME/.local/share/panachat-backups}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-lobe-postgres}"
POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-panachat_postgres_data}"
RUSTFS_VOLUME_NAME="${RUSTFS_VOLUME_NAME:-panachat_rustfs_data}"
LOBE_DB_NAME="${LOBE_DB_NAME:-lobechat}"

KEEP_DAILY_DAYS="${PANACHAT_KEEP_DAILY_DAYS:-14}"
KEEP_WEEKLY_DAYS="${PANACHAT_KEEP_WEEKLY_DAYS:-56}"
KEEP_MONTHLY_DAYS="${PANACHAT_KEEP_MONTHLY_DAYS:-365}"
KEEP_PREDEPLOY="${PANACHAT_KEEP_PREDEPLOY:-5}"

REASON="manual"
DO_INSTALL_CRON=0
DO_LIST=0
DO_PRUNE_ONLY=0
STRICT=0
RESTORE_FILE=""

load_deploy_env() {
  [[ -f "$DEPLOY_DIR/.env" ]] || return 0
  local key val
  for key in PANACHAT_DATA_DIR PANACHAT_BACKUP_DIR LOBE_DB_NAME POSTGRES_VOLUME_NAME RUSTFS_VOLUME_NAME; do
    val="$(grep -E "^${key}=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
    if [[ -n "$val" ]]; then
      printf -v "$key" '%s' "$val"
    fi
  done
}

usage() {
  cat <<EOF
Usage: panachat-backup.sh [options]

Options:
  --reason <daily|pre-deploy|manual>   Tag for this run (default: manual)
  --restore <file.sql.gz>              Restore a SQL dump into running Postgres
  --install-cron                       Install daily 03:00 user crontab entry
  --list                               List backup files
  --prune-only                         Only apply retention (no new dump)
  --strict                             Fail if Postgres is not running
  -h, --help                           Show help

Postgres / Redis / RustFS storage (moz local):
  Postgres volume: ${POSTGRES_VOLUME_NAME}
  RustFS volume:   ${RUSTFS_VOLUME_NAME}
  Fingerprint:     \$PANACHAT_DATA_DIR/.moz-db-fingerprint

Retention (one dump job; keepers from the same files):
  daily:      last ${KEEP_DAILY_DAYS} days
  weekly:     Sunday dumps up to ${KEEP_WEEKLY_DAYS} days
  monthly:    1st-of-month dumps up to ${KEEP_MONTHLY_DAYS} days
  pre-deploy: last ${KEEP_PREDEPLOY} pre-deploy dumps (always)

Skip: MOZ_SKIP_BACKUP=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason)
      REASON="${2:-}"
      shift 2
      ;;
    --reason=*)
      REASON="${1#*=}"
      shift
      ;;
    --restore)
      RESTORE_FILE="${2:-}"
      shift 2
      ;;
    --restore=*)
      RESTORE_FILE="${1#*=}"
      shift
      ;;
    --install-cron)
      DO_INSTALL_CRON=1
      shift
      ;;
    --list)
      DO_LIST=1
      shift
      ;;
    --prune-only)
      DO_PRUNE_ONLY=1
      shift
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1 (try --help)" >&2
      exit 2
      ;;
  esac
done

case "$REASON" in
  daily|pre-deploy|manual) ;;
  *)
    echo "Error: --reason must be daily, pre-deploy, or manual (got: $REASON)" >&2
    exit 2
    ;;
esac

if [[ "${MOZ_SKIP_BACKUP:-}" == "1" && -z "$RESTORE_FILE" ]]; then
  echo "==> Backup skipped (MOZ_SKIP_BACKUP=1)"
  exit 0
fi

load_deploy_env

stamp="$(date +%Y%m%d-%H%M%S)"
day="$(date +%Y-%m-%d)"
dow="$(date +%u)" # 1=Mon … 7=Sun
dom="$(date +%d)"

mkdir -p "$PANACHAT_BACKUP_DIR"

install_cron() {
  local script="$ROOT/scripts/panachat-backup.sh"
  local log="$PANACHAT_BACKUP_DIR/backup.log"
  local line="0 3 * * * $script --reason daily >>$log 2>&1"
  local existing
  existing="$(crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$existing" | grep -Fq "$script"; then
    echo "==> Cron already installed for $script"
    printf '%s\n' "$existing" | grep -F "$script" || true
    return 0
  fi
  {
    printf '%s\n' "$existing"
    echo "$line"
  } | grep -v '^$' | crontab -
  echo "==> Installed daily backup cron (03:00):"
  echo "    $line"
  echo "    Log: $log"
}

list_backups() {
  echo "Backup dir: $PANACHAT_BACKUP_DIR"
  if compgen -G "$PANACHAT_BACKUP_DIR/panachat-*" >/dev/null; then
    ls -lh "$PANACHAT_BACKUP_DIR"/panachat-* | sed 's|^|  |'
  else
    echo "  (empty)"
  fi
}

postgres_running() {
  [[ "$(docker inspect -f '{{.State.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || echo missing)" == "running" ]]
}

fingerprint_file() {
  echo "$PANACHAT_DATA_DIR/.moz-db-fingerprint"
}

load_fingerprint_users() {
  local file
  file="$(fingerprint_file)"
  [[ -f "$file" ]] || return 1
  grep -E '^users=' "$file" 2>/dev/null | head -1 | cut -d= -f2-
}

postgres_pgdata_fstype() {
  docker exec "$POSTGRES_CONTAINER" sh -c \
    'df -T /var/lib/postgresql/data 2>/dev/null | awk "NR==2{print \$2}"' 2>/dev/null || echo unknown
}

postgres_user_count() {
  docker exec "$POSTGRES_CONTAINER" psql -U postgres -d "$LOBE_DB_NAME" -Atc \
    "SELECT count(*) FROM users;" 2>/dev/null || echo "?"
}

# Refuse dumps that would archive a known-bad empty/tmpfs DB as if it were healthy.
assert_postgres_safe_to_dump() {
  local fstype live_users fp_users

  fstype="$(postgres_pgdata_fstype)"
  if moz_should_refuse_tmpfs_dump "$fstype" "${MOZ_ALLOW_TMPFS_PGDATA:-0}"; then
    cat >&2 <<EOF
Error: refusing backup — Postgres PGDATA is on $fstype (empty RAM disk).

  A dump now would archive an empty DB and can look like "data was deleted".
  Fix the mount (moz -k && moz -d), then retry. Override only if intentional:
    MOZ_ALLOW_TMPFS_PGDATA=1 moz -B
EOF
    return 1
  fi
  if moz_is_tmpfs_pgdata "$fstype"; then
    echo "==> Warning: PGDATA is $fstype — dumping anyway (MOZ_ALLOW_TMPFS_PGDATA=1)"
  fi

  live_users="$(postgres_user_count)"
  fp_users="$(load_fingerprint_users || true)"
  if moz_should_refuse_empty_backup "$live_users" "$fp_users" "${MOZ_ALLOW_EMPTY_BACKUP:-0}"; then
    cat >&2 <<EOF
Error: refusing backup — live users=0 but last healthy fingerprint had $fp_users users.

  This usually means Postgres is on a bad/empty mount. Do not treat this dump as recovery.
  Recover first (moz -k && moz -d), or override:
    MOZ_ALLOW_EMPTY_BACKUP=1 moz -B
EOF
    return 1
  fi
  if [[ "$fp_users" =~ ^[0-9]+$ && "$fp_users" -gt 0 ]] \
    && [[ "$live_users" =~ ^[0-9]+$ && "$live_users" -eq 0 ]]; then
    echo "==> Warning: live users=0 but fingerprint users=$fp_users — dumping anyway (MOZ_ALLOW_EMPTY_BACKUP=1)"
  fi

  echo "    PGDATA fs=$fstype  users=${live_users}  volume=${POSTGRES_VOLUME_NAME}"
}

restore_sql_dump() {
  local file="$1"
  local live_users fstype

  if [[ -z "$file" ]]; then
    echo "Error: --restore requires a .sql.gz path" >&2
    exit 2
  fi
  if [[ ! -f "$file" ]]; then
    echo "Error: restore file not found: $file" >&2
    exit 1
  fi
  if [[ "$file" != *.sql.gz && "$file" != *.sql ]]; then
    echo "Error: restore file must be .sql.gz or .sql (got: $file)" >&2
    exit 2
  fi
  if ! postgres_running; then
    echo "Error: Postgres '$POSTGRES_CONTAINER' is not running — start with: moz" >&2
    exit 1
  fi

  fstype="$(postgres_pgdata_fstype)"
  if moz_is_tmpfs_pgdata "$fstype"; then
    cat >&2 <<EOF
Error: refusing restore — PGDATA is on $fstype. Fix the mount first:
  moz -k && moz -d
EOF
    exit 1
  fi

  live_users="$(postgres_user_count)"
  echo "==> Restoring into $POSTGRES_CONTAINER / db=$LOBE_DB_NAME"
  echo "    File:   $file"
  echo "    Volume: $POSTGRES_VOLUME_NAME (fs=$fstype)"
  echo "    Live users before restore: $live_users"
  echo "    Note: dump is applied on top of the current DB (not a full wipe)."
  echo "    For a clean slate: moz -k && docker volume rm $POSTGRES_VOLUME_NAME && MOZ_ALLOW_EMPTY_DB=1 moz -d"
  echo "                       then re-run this restore."

  if [[ "$file" == *.sql.gz ]]; then
    gunzip -c "$file" | docker exec -i "$POSTGRES_CONTAINER" \
      psql -U postgres -d "$LOBE_DB_NAME" -v ON_ERROR_STOP=1
  else
    docker exec -i "$POSTGRES_CONTAINER" \
      psql -U postgres -d "$LOBE_DB_NAME" -v ON_ERROR_STOP=1 <"$file"
  fi

  live_users="$(postgres_user_count)"
  echo "==> Restore finished. Live users now: $live_users"
  echo "    Tip: moz -i   # refresh status / fingerprint on next healthy deploy"
}

# Parse panachat-YYYYMMDD-HHMMSS-<reason>.(sql.gz|rustfs.tar.gz|meta.txt)
# Sets: _ymd _reason_tag _kind  (kind=sql|rustfs|meta)
parse_backup_name() {
  local base="$1"
  _ymd=""
  _reason_tag=""
  _kind=""
  if [[ "$base" =~ ^panachat-([0-9]{8})-[0-9]{6}-([a-z-]+)\.sql\.gz$ ]]; then
    _ymd="${BASH_REMATCH[1]}"
    _reason_tag="${BASH_REMATCH[2]}"
    _kind="sql"
    return 0
  fi
  if [[ "$base" =~ ^panachat-([0-9]{8})-[0-9]{6}-([a-z-]+)\.rustfs\.tar\.gz$ ]]; then
    _ymd="${BASH_REMATCH[1]}"
    _reason_tag="${BASH_REMATCH[2]}"
    _kind="rustfs"
    return 0
  fi
  if [[ "$base" =~ ^panachat-([0-9]{8})-[0-9]{6}-([a-z-]+)\.meta\.txt$ ]]; then
    _ymd="${BASH_REMATCH[1]}"
    _reason_tag="${BASH_REMATCH[2]}"
    _kind="meta"
    return 0
  fi
  return 1
}

calendar_keep() {
  local ymd="$1"
  local file_day age_days file_dow file_dom
  file_day="${ymd:0:4}-${ymd:4:2}-${ymd:6:2}"
  age_days=$(( ( $(date +%s) - $(date -d "$file_day" +%s) ) / 86400 ))
  file_dow="$(date -d "$file_day" +%u)"
  file_dom="$(date -d "$file_day" +%d)"

  if (( age_days <= KEEP_DAILY_DAYS )); then
    return 0
  fi
  if [[ "$file_dow" == "7" ]] && (( age_days <= KEEP_WEEKLY_DAYS )); then
    return 0
  fi
  if [[ "$file_dom" == "01" ]] && (( age_days <= KEEP_MONTHLY_DAYS )); then
    return 0
  fi
  return 1
}

# Build set of backup stems (panachat-YYYYMMDD-HHMMSS-reason) to keep.
compute_keep_stems() {
  local -a sql_files=()
  local -a pre_deploy=()
  local f base stem
  KEEP_STEMS=()

  shopt -s nullglob
  for f in "$PANACHAT_BACKUP_DIR"/panachat-*.sql.gz; do
    base="$(basename "$f")"
    parse_backup_name "$base" || continue
    stem="${base%.sql.gz}"
    sql_files+=("$stem")
    if calendar_keep "$_ymd"; then
      KEEP_STEMS+=("$stem")
      continue
    fi
    if [[ "$_reason_tag" == "pre-deploy" ]]; then
      pre_deploy+=("$stem")
    fi
  done

  if ((${#pre_deploy[@]} > 0)); then
    mapfile -t pre_deploy < <(printf '%s\n' "${pre_deploy[@]}" | sort -r)
    local i=0
    for stem in "${pre_deploy[@]}"; do
      i=$((i + 1))
      (( i > KEEP_PREDEPLOY )) && break
      KEEP_STEMS+=("$stem")
    done
  fi
}

stem_is_kept() {
  local needle="$1" s
  for s in "${KEEP_STEMS[@]:-}"; do
    [[ "$s" == "$needle" ]] && return 0
  done
  return 1
}

prune_backups() {
  compute_keep_stems

  local f base stem removed=0
  shopt -s nullglob
  for f in "$PANACHAT_BACKUP_DIR"/panachat-*.sql.gz \
    "$PANACHAT_BACKUP_DIR"/panachat-*.rustfs.tar.gz \
    "$PANACHAT_BACKUP_DIR"/panachat-*.meta.txt; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    parse_backup_name "$base" || continue
    case "$_kind" in
      sql) stem="${base%.sql.gz}" ;;
      rustfs) stem="${base%.rustfs.tar.gz}" ;;
      meta) stem="${base%.meta.txt}" ;;
      *) continue ;;
    esac
    if stem_is_kept "$stem"; then
      continue
    fi
    rm -f "$f"
    removed=$((removed + 1))
    echo "  pruned: $base"
  done

  echo "==> Retention: removed $removed file(s) (daily≤${KEEP_DAILY_DAYS}d, weekly≤${KEEP_WEEKLY_DAYS}d, monthly≤${KEEP_MONTHLY_DAYS}d, pre-deploy≤${KEEP_PREDEPLOY})"
}

create_backup() {
  local base="panachat-${stamp}-${REASON}"
  local sql_path="$PANACHAT_BACKUP_DIR/${base}.sql.gz"
  local rustfs_path="$PANACHAT_BACKUP_DIR/${base}.rustfs.tar.gz"
  local rustfs_src="$PANACHAT_DATA_DIR/rustfs"
  local live_users="?" fstype="?" fp_users="" rustfs_archived=0

  echo "==> Backup reason=$REASON"
  echo "    Data dir:   $PANACHAT_DATA_DIR"
  echo "    Backup dir: $PANACHAT_BACKUP_DIR"
  echo "    PG volume:     $POSTGRES_VOLUME_NAME"
  echo "    RustFS volume: $RUSTFS_VOLUME_NAME"

  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: docker is required for SQL dumps" >&2
    exit 1
  fi

  if ! postgres_running; then
    if (( STRICT == 1 )); then
      echo "Error: Postgres container '$POSTGRES_CONTAINER' is not running" >&2
      exit 1
    fi
    fp_users="$(load_fingerprint_users || true)"
    if [[ "$fp_users" =~ ^[0-9]+$ && "$fp_users" -gt 0 ]]; then
      if [[ "${MOZ_ALLOW_EMPTY_BACKUP:-}" == "1" ]]; then
        echo "==> Warning: Postgres not running but fingerprint users=$fp_users — continuing without SQL dump (MOZ_ALLOW_EMPTY_BACKUP=1)"
      else
        cat >&2 <<EOF
Error: refusing backup — Postgres is not running but last healthy fingerprint had $fp_users users.

  A pre-deploy dump would skip SQL and leave you without a recovery copy of the known-good DB.
  Start the stack (moz), then retry. Override only if intentional:
    MOZ_ALLOW_EMPTY_BACKUP=1 moz -B
EOF
        exit 1
      fi
    else
      echo "⚠️  Postgres not running — skipped SQL dump (start stack with: moz)"
    fi
  else
    assert_postgres_safe_to_dump
    live_users="$(postgres_user_count)"
    fstype="$(postgres_pgdata_fstype)"
    echo "==> Dumping database '$LOBE_DB_NAME' from $POSTGRES_CONTAINER"
    docker exec "$POSTGRES_CONTAINER" pg_dump -U postgres -d "$LOBE_DB_NAME" --no-owner --no-acl \
      | gzip -c >"$sql_path"
    echo "    SQL: $(basename "$sql_path") ($(du -h "$sql_path" | awk '{print $1}'))"
  fi

  if docker volume inspect "$RUSTFS_VOLUME_NAME" >/dev/null 2>&1; then
    if docker run --rm \
      -v "$RUSTFS_VOLUME_NAME:/rustfs:ro" \
      -v "$PANACHAT_BACKUP_DIR:/out" \
      alpine sh -c 'find /rustfs -type f ! -path "*/.*" | grep -q . || exit 2
        tar -C / -czf /out/'"$(basename "$rustfs_path")"' rustfs'; then
      rustfs_archived=1
    fi
  fi
  if [[ $rustfs_archived -eq 0 ]] \
    && [[ -d "$rustfs_src" ]] \
    && find "$rustfs_src" -type f ! -path '*/.*' 2>/dev/null | grep -q .; then
    tar -C "$PANACHAT_DATA_DIR" -czf "$rustfs_path" rustfs
    rustfs_archived=1
  fi
  if [[ $rustfs_archived -eq 1 ]]; then
    echo "==> Archiving RustFS uploads"
    echo "    RustFS: $(basename "$rustfs_path") ($(du -h "$rustfs_path" | awk '{print $1}'))"
  else
    echo "==> RustFS empty/missing — skipped"
  fi

  {
    echo "created_at=$(date -Iseconds)"
    echo "reason=$REASON"
    echo "day=$day dow=$dow dom=$dom"
    echo "data_dir=$PANACHAT_DATA_DIR"
    echo "postgres_volume=$POSTGRES_VOLUME_NAME"
    echo "rustfs_volume=$RUSTFS_VOLUME_NAME"
    echo "postgres_container=$POSTGRES_CONTAINER"
    echo "pgdata_fstype=$fstype"
    echo "users=$live_users"
    echo "db=$LOBE_DB_NAME"
    echo "host=$(hostname 2>/dev/null || echo unknown)"
  } >"$PANACHAT_BACKUP_DIR/${base}.meta.txt"
}

if [[ $DO_INSTALL_CRON -eq 1 ]]; then
  install_cron
  exit 0
fi

if [[ $DO_LIST -eq 1 ]]; then
  list_backups
  exit 0
fi

if [[ $DO_PRUNE_ONLY -eq 1 ]]; then
  prune_backups
  list_backups
  exit 0
fi

if [[ -n "$RESTORE_FILE" ]]; then
  restore_sql_dump "$RESTORE_FILE"
  exit 0
fi

create_backup
prune_backups
list_backups
