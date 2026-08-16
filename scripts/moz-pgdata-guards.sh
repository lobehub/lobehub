#!/usr/bin/env bash
# Pure helpers for moz Postgres mount/backup safety (no Docker).
# Sourced by deploy-local.sh and panachat-backup.sh.

# True when the container's PGDATA filesystem is the empty-RAM failure mode.
moz_is_tmpfs_pgdata() {
  local fstype="${1:-}"
  [[ "$fstype" == "tmpfs" || "$fstype" == "none" ]]
}

# True when a SQL dump should be refused because PGDATA is tmpfs/none.
# Pass allow=1 (MOZ_ALLOW_TMPFS_PGDATA) to skip the refuse.
moz_should_refuse_tmpfs_dump() {
  local fstype="${1:-}"
  local allow="${2:-0}"
  [[ "$allow" == "1" ]] && return 1
  moz_is_tmpfs_pgdata "$fstype"
}

# True when a dump would archive a known-empty live DB after a healthy fingerprint.
# Pass allow=1 (MOZ_ALLOW_EMPTY_BACKUP) to skip the refuse.
moz_should_refuse_empty_backup() {
  local live_users="${1:-}"
  local fp_users="${2:-}"
  local allow="${3:-0}"
  [[ "$allow" == "1" ]] && return 1
  [[ "$fp_users" =~ ^[0-9]+$ && "$fp_users" -gt 0 ]] \
    && [[ "$live_users" =~ ^[0-9]+$ && "$live_users" -eq 0 ]]
}
