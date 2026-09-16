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

caller_deepseek_key="${DEEPSEEK_API_KEY:-}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

persist_deepseek_key() {
  EVAL_ENV_FILE="$ENV_FILE" EVAL_SECRET_VALUE="$1" node <<'NODE'
const fs = require('node:fs');

const path = process.env.EVAL_ENV_FILE;
const value = process.env.EVAL_SECRET_VALUE;
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
const index = lines.findIndex((line) => /^DEEPSEEK_API_KEY=/.test(line));
if (index < 0) throw new Error('DEEPSEEK_API_KEY is missing from the eval env template');
lines[index] = `DEEPSEEK_API_KEY=${value}`;
fs.writeFileSync(path, lines.join('\n'));
NODE
}

if [[ -z "${DEEPSEEK_API_KEY:-}" && -n "$caller_deepseek_key" ]]; then
  persist_deepseek_key "$caller_deepseek_key"
  export DEEPSEEK_API_KEY="$caller_deepseek_key"
fi

if [[ "$MODE" != "--infra-only" && -z "${DEEPSEEK_API_KEY:-}" ]]; then
  printf 'DEEPSEEK_API_KEY is required in %s before bootstrapping the eval server.\n' "$ENV_FILE" >&2
  exit 1
fi

# Reuse the repository acceptance bootstrap as the single source of truth for
# the local signing key and seeded user contract.
AGENT_TESTING_CLI_ENV_FILE="$CLI_ENV_FILE" \
  bash "$INIT_DEV_ENV" env >/dev/null

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
  bash "$INIT_DEV_ENV" seed-user >/dev/null

printf 'Eval infrastructure, migrations, and baseline user are ready.\n'
