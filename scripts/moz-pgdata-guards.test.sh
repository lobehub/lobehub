#!/usr/bin/env bash
# Regression tests for moz tmpfs / empty-backup guards.
# Bug: Docker Desktop + WSL2 sometimes mounts PGDATA as tmpfs; moz -u then dumped
# 0 users and looked like data loss. These helpers must refuse that dump.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=moz-pgdata-guards.sh
source "$SCRIPT_DIR/moz-pgdata-guards.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_true() {
  "$@" || fail "expected success: $*"
}

assert_false() {
  if "$@"; then
    fail "expected failure: $*"
  fi
}

assert_true moz_is_tmpfs_pgdata tmpfs
assert_true moz_is_tmpfs_pgdata none
assert_false moz_is_tmpfs_pgdata ext4
assert_false moz_is_tmpfs_pgdata overlay
assert_false moz_is_tmpfs_pgdata ""

assert_true moz_should_refuse_tmpfs_dump tmpfs 0
assert_true moz_should_refuse_tmpfs_dump none 0
assert_false moz_should_refuse_tmpfs_dump tmpfs 1
assert_false moz_should_refuse_tmpfs_dump ext4 0

assert_true moz_should_refuse_empty_backup 0 10 0
assert_true moz_should_refuse_empty_backup 0 1 0
assert_false moz_should_refuse_empty_backup 0 10 1
assert_false moz_should_refuse_empty_backup 10 10 0
assert_false moz_should_refuse_empty_backup 0 0 0
assert_false moz_should_refuse_empty_backup "?" 10 0
assert_false moz_should_refuse_empty_backup 0 "?" 0

COMPOSE="$SCRIPT_DIR/../docker-compose/deploy/docker-compose.aico.data.override.yml"
grep -q 'panachat_postgres_data:/var/lib/postgresql/data' "$COMPOSE" \
  || fail "compose override must mount named volume panachat_postgres_data for PGDATA"
grep -q '${PANACHAT_DATA_DIR}/postgres:/var/lib/postgresql/data' "$COMPOSE" \
  && fail "compose override must not bind-mount host postgres (WSL2 tmpfs bug)"

DEPLOY="$SCRIPT_DIR/deploy-local.sh"
grep -q 'prepare_postgres_for_deploy' "$DEPLOY" \
  || fail "deploy-local.sh must remount named volume before backup/fingerprint"
# Remount *call* (not the function definition) must appear before pre-deploy backup.
backup_line="$(grep -n 'run_panachat_backup pre-deploy' "$DEPLOY" | head -1 | cut -d: -f1)"
prepare_line="$(grep -n '^  prepare_postgres_for_deploy$' "$DEPLOY" | head -1 | cut -d: -f1)"
[[ -n "$backup_line" && -n "$prepare_line" ]] || fail "missing backup/prepare line numbers"
(( prepare_line < backup_line )) || fail "prepare_postgres_for_deploy must run before pre-deploy backup (was $prepare_line >= $backup_line)"

# cluster_safe must run inside ensure_postgres_named_volume_mount BEFORE compose up
# (otherwise the Postgres image initdb's an empty volume).
python3 - "$DEPLOY" <<'PY' || fail "assert_postgres_cluster_safe must run before force-recreate postgresql"
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text().splitlines()
start = next(i for i, line in enumerate(text) if line.startswith("ensure_postgres_named_volume_mount()"))
end = start + 1
while end < len(text) and not text[end].startswith("prepare_postgres_for_deploy()"):
    end += 1
block = "\n".join(text[start:end])
i_safe = block.find("assert_postgres_cluster_safe")
i_up = block.find("force-recreate --no-deps postgresql")
if i_safe < 0 or i_up < 0 or i_safe > i_up:
    raise SystemExit(1)
PY

echo "OK: moz-pgdata-guards"
