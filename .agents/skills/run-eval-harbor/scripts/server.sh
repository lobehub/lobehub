#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
ENV_FILE="${LOBEHUB_EVAL_ENV:-$REPO_ROOT/docker-compose/eval/.env}"
JWKS_FILE="$REPO_ROOT/.records/env/agent-testing-jwks.json"

[[ -f "$ENV_FILE" ]] || { printf 'Missing %s; run the eval bootstrap script first.\n' "$ENV_FILE" >&2; exit 1; }
[[ -s "$JWKS_FILE" ]] || { printf 'Missing %s; run the eval bootstrap script first.\n' "$JWKS_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export JWKS_KEY
JWKS_KEY="$(tr -d '\n' < "$JWKS_FILE")"
export NODE_ENV=production

cd "$REPO_ROOT"
exec bun run start
