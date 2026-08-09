#!/usr/bin/env bash
# Backup PanaChat / Aico deploy data (Postgres dump + RustFS uploads).
#
# Usage:
#   ./scripts/panachat-backup.sh                  # manual backup
#   ./scripts/panachat-backup.sh --reason daily
#   ./scripts/panachat-backup.sh --reason pre-deploy
#   ./scripts/panachat-backup.sh --install-cron    # daily 03:00 user crontab
#   ./scripts/panachat-backup.sh --list
#   ./scripts/panachat-backup.sh --prune-only
#
# Env (optional; also read from docker-compose/deploy/.env):
#   PANACHAT_DATA_DIR      default ~/.local/share/panachat-data
#   PANACHAT_BACKUP_DIR    default ~/.local/share/panachat-backups
#   LOBE_DB_NAME           default lobechat
#   POSTGRES_CONTAINER     default lobe-postgres
#   PANACHAT_KEEP_DAILY_DAYS=14
#   PANACHAT_KEEP_WEEKLY_DAYS=56
#   PANACHAT_KEEP_MONTHLY_DAYS=365
#   PANACHAT_KEEP_PREDEPLOY=5
#   MOZ_SKIP_BACKUP=1      no-op exit 0 (used by moz)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/docker-compose/deploy"

PANACHAT_DATA_DIR="${PANACHAT_DATA_DIR:-$HOME/.local/share/panachat-data}"
PANACHAT_BACKUP_DIR="${PANACHAT_BACKUP_DIR:-$HOME/.local/share/panachat-backups}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-lobe-postgres}"
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

load_deploy_env() {
  [[ -f "$DEPLOY_DIR/.env" ]] || return 0
  local key val
  for key in PANACHAT_DATA_DIR PANACHAT_BACKUP_DIR LOBE_DB_NAME; do
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
  --install-cron                       Install daily 03:00 user crontab entry
  --list                               List backup files
  --prune-only                         Only apply retention (no new dump)
  --strict                             Fail if Postgres is not running
  -h, --help                           Show help

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

if [[ "${MOZ_SKIP_BACKUP:-}" == "1" ]]; then
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

  echo "==> Backup reason=$REASON"
  echo "    Data dir:   $PANACHAT_DATA_DIR"
  echo "    Backup dir: $PANACHAT_BACKUP_DIR"

  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: docker is required for SQL dumps" >&2
    exit 1
  fi

  if ! postgres_running; then
    if (( STRICT == 1 )); then
      echo "Error: Postgres container '$POSTGRES_CONTAINER' is not running" >&2
      exit 1
    fi
    echo "⚠️  Postgres not running — skipped SQL dump (start stack with: moz)"
  else
    echo "==> Dumping database '$LOBE_DB_NAME' from $POSTGRES_CONTAINER"
    docker exec "$POSTGRES_CONTAINER" pg_dump -U postgres -d "$LOBE_DB_NAME" --no-owner --no-acl \
      | gzip -c >"$sql_path"
    echo "    SQL: $(basename "$sql_path") ($(du -h "$sql_path" | awk '{print $1}'))"
  fi

  if [[ -d "$rustfs_src" ]] && find "$rustfs_src" -type f ! -path '*/.*' 2>/dev/null | grep -q .; then
    echo "==> Archiving RustFS uploads"
    tar -C "$PANACHAT_DATA_DIR" -czf "$rustfs_path" rustfs
    echo "    RustFS: $(basename "$rustfs_path") ($(du -h "$rustfs_path" | awk '{print $1}'))"
  else
    echo "==> RustFS empty/missing — skipped"
  fi

  {
    echo "created_at=$(date -Iseconds)"
    echo "reason=$REASON"
    echo "day=$day dow=$dow dom=$dom"
    echo "data_dir=$PANACHAT_DATA_DIR"
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

create_backup
prune_backups
list_backups
