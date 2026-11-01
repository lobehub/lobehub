#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
ENV_FILE="${LOBEHUB_EVAL_ENV:-$REPO_ROOT/docker-compose/eval/.env}"
ENV_EXAMPLE="$REPO_ROOT/docker-compose/eval/.env.example"
COMPOSE_FILE="$REPO_ROOT/docker-compose/eval/docker-compose.yml"
INIT_DEV_ENV="$REPO_ROOT/.agents/acceptance/scripts/init-dev-env.sh"
JWKS_FILE="$REPO_ROOT/.records/env/agent-testing-jwks.json"
CLI_ENV_FILE="$REPO_ROOT/.records/env/eval-harbor-cli.env"
MODE="${1:-}"

if [[ "$MODE" != "" && "$MODE" != "--infra-only" ]]; then
  printf 'Usage: %s [--infra-only]\n' "$0" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  printf 'Created %s from .env.example\n' "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Reuse the repository acceptance bootstrap as the single source of truth for
# the local signing key and seeded user contract.
AGENT_TESTING_CLI_ENV_FILE="$CLI_ENV_FILE" \
  bash "$INIT_DEV_ENV" --env-file "$ENV_FILE" env >/dev/null

if [[ ! -s "$JWKS_FILE" ]]; then
  printf 'init-dev-env.sh did not create %s\n' "$JWKS_FILE" >&2
  exit 1
fi

export JWKS_KEY
JWKS_KEY="$(tr -d '\n' < "$JWKS_FILE")"
export EVAL_JWKS_PUBLIC_KEY
EVAL_JWKS_PUBLIC_KEY="$(JWKS_FILE="$JWKS_FILE" node <<'NODE'
const fs = require('node:fs');

const privateJwks = JSON.parse(fs.readFileSync(process.env.JWKS_FILE, 'utf8'));
const privateFields = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi']);
const keys = privateJwks.keys.map((key) =>
  Object.fromEntries(Object.entries(key).filter(([name]) => !privateFields.has(name))),
);
process.stdout.write(JSON.stringify({ keys }));
NODE
)"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait

if [[ "$MODE" == "--infra-only" ]]; then
  exit 0
fi

cd "$REPO_ROOT"
bun --env-file="$ENV_FILE" run db:migrate
AGENT_TESTING_CLI_ENV_FILE="$CLI_ENV_FILE" \
  bash "$INIT_DEV_ENV" --env-file "$ENV_FILE" seed-user >/dev/null

printf 'Eval infrastructure, migrations, and baseline user are ready.\n'
