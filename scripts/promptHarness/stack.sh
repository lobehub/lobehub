#!/usr/bin/env bash
# Run one isolated prompt-capture stack. Never uses the Debug Proxy, production
# backend, a fixed dev port, the shared database, or the shared Redis prefix.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_FILE="${TMPDIR:-/tmp}/lobehub-prompt-harness.lock"

cd "$REPO_ROOT"

exec 9> "$LOCK_FILE"
if ! flock -n 9; then
  echo "Another prompt-harness stack is active (lock: $LOCK_FILE)." >&2
  exit 2
fi

if [[ ! -f .env ]]; then
  echo "Missing .env. This harness requires the local Postgres/Redis test environment." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
if [[ -f .records/env/agent-testing-cli.env ]]; then
  # shellcheck disable=SC1091
  source .records/env/agent-testing-cli.env
fi
set +a

if [[ -z "${LOBEHUB_CLI_API_KEY:-}" ]]; then
  echo "LOBEHUB_CLI_API_KEY is required; seed it with the project acceptance helper." >&2
  exit 2
fi

export PROMPT_HARNESS_ENV=test
export PROMPT_HARNESS_PG_CONTAINER="${PROMPT_HARNESS_PG_CONTAINER:-lobehub-agent-testing-postgres}"

if [[ "${PROMPT_HARNESS_ENV}" != "test" ]]; then
  echo "PROMPT_HARNESS_ENV must be test." >&2
  exit 2
fi

exec bun scripts/promptHarness/run.ts "$@"
