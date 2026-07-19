#!/usr/bin/env bash
# init-dev-env.sh — self-contained local dev env for agent testing.
#
# This script initializes the env needed to run LobeHub's normal local dev
# server without depending on a root .env file. It follows the same shape as
# the e2e bootstrap (Postgres + migrations + auth/key-vault/S3 test env), but
# starts the repo's dev server, not the standalone e2e server.
#
# Guardrail: if repo-root .env exists, every non-help command exits immediately.
# Existing local config always wins.
#
# Usage:
#   init-dev-env.sh env              # print shell exports
#   init-dev-env.sh write [file]     # write a source-able env file
#   init-dev-env.sh setup-db         # start local Postgres/Redis and run migrations
#   init-dev-env.sh migrate          # run DB migrations against the configured DB
#   init-dev-env.sh seed-user        # seed the baseline test user + CLI API key
#   init-dev-env.sh qstash           # run local Upstash QStash dev server
#   init-dev-env.sh s3               # run local s3rver object storage
#   init-dev-env.sh preflight        # check agent-runtime prerequisites (QStash + S3)
#   init-dev-env.sh dev-next         # exec `pnpm run dev:next` with this env
#   init-dev-env.sh dev              # exec `bun run dev` with this env
#   init-dev-env.sh stop-dev         # stop the dev server (Next + Vite) started by `dev`
#   init-dev-env.sh clean            # teardown: stop dev server (DB/Redis/S3 data kept)
#   init-dev-env.sh clean-s3         # remove local S3 test data
#   init-dev-env.sh clean-db         # remove the managed Postgres/Redis containers
#
# Overrides:
#   SERVER_PORT=3010 DB_PORT=5433 DB_CONTAINER=lobehub-agent-testing-postgres REDIS_PORT=6380 REDIS_CONTAINER=lobehub-agent-testing-redis QSTASH_DEV_PORT=8080 S3_DEV_PORT=29000
#   AGENT_TESTING_DEV_STATE_FILE=.records/runtime/agent-testing-dev.state

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ROOT_ENV_FILE="$REPO_ROOT/.env"

# Resolve the workspace root the SAME way test-env.sh does, so both scripts
# read/write the ports file (and other .records artifacts) at the same path.
# When the skill resolves under a cloud checkout's submodule
# (.../lobehub-cloud*/lobehub), REPO_ROOT is the submodule but the shared
# .records lives at the cloud parent — mismatching it would make setup-db/dev
# allocate ports that test-env.sh / setup-auth.sh never read.
WORKSPACE_ROOT="$REPO_ROOT"
if [[ "$(basename "$WORKSPACE_ROOT")" == "lobehub" ]]; then
  _parent_root="$(cd "$WORKSPACE_ROOT/.." && pwd)"
  [[ "$(basename "$_parent_root")" == lobehub-cloud* ]] && WORKSPACE_ROOT="$_parent_root"
fi

# --- auto-allocated, non-conflicting ports (persisted per workspace) ---------
# Each repo copy (lobehub-cloud, lobehub-cloud-cc, ...) probes its own free
# SERVER_PORT / SPA_PORT so copies running concurrently never fight over
# 3010/9876. Ports are probed once then persisted, so repeated calls (setup-db,
# seed-user, dev, web-seed) and test-env.sh all agree on the same port. Delete
# the ports file (or pass SERVER_PORT=... explicitly) to re-allocate.
PORTS_FILE="${AGENT_TESTING_PORTS_FILE:-$WORKSPACE_ROOT/.records/env/agent-testing-ports.env}"
DEV_STATE_FILE="${AGENT_TESTING_DEV_STATE_FILE:-$WORKSPACE_ROOT/.records/runtime/agent-testing-dev.state}"

_port_in_use() { lsof -iTCP:"$1" -sTCP:LISTEN > /dev/null 2>&1; }
_pick_free_port() {
  local fallback="$1" p
  for _ in $(seq 1 80); do
    p=$(((RANDOM % 20000) + 20000))
    _port_in_use "$p" || {
      printf '%s' "$p"
      return 0
    }
  done
  printf '%s' "$fallback"
}
_load_or_alloc_ports() {
  # Reuse persisted ports verbatim once allocated — the port being "in use" is
  # expected (our own dev server holds it), so never re-probe on reuse.
  # shellcheck disable=SC1090
  [[ -f "$PORTS_FILE" ]] && source "$PORTS_FILE"
  local changed=0
  if [[ -z "${ALLOC_SERVER_PORT:-}" ]]; then
    ALLOC_SERVER_PORT="$(_pick_free_port 3010)"
    changed=1
  fi
  if [[ -z "${ALLOC_SPA_PORT:-}" ]]; then
    ALLOC_SPA_PORT="$(_pick_free_port 9876)"
    changed=1
  fi
  if [[ "$changed" == 1 ]]; then
    mkdir -p "$(dirname "$PORTS_FILE")"
    {
      printf '# agent-testing auto-allocated ports (delete to re-allocate)\n'
      printf 'ALLOC_SERVER_PORT=%s\n' "$ALLOC_SERVER_PORT"
      printf 'ALLOC_SPA_PORT=%s\n' "$ALLOC_SPA_PORT"
    } > "$PORTS_FILE"
  fi
}
_load_or_alloc_ports

SERVER_PORT="${SERVER_PORT:-$ALLOC_SERVER_PORT}"
SPA_PORT="${SPA_PORT:-$ALLOC_SPA_PORT}"
DB_PORT="${DB_PORT:-5433}"
DB_CONTAINER="${DB_CONTAINER:-lobehub-agent-testing-postgres}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:${DB_PORT}/postgres}"
REDIS_PORT="${REDIS_PORT:-6380}"
REDIS_CONTAINER="${REDIS_CONTAINER:-lobehub-agent-testing-redis}"
REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
ENV_FILE_DEFAULT="$WORKSPACE_ROOT/.records/env/agent-testing-dev.env"
CLI_ENV_FILE_DEFAULT="$WORKSPACE_ROOT/.records/env/agent-testing-cli.env"
AGENT_TESTING_API_KEY="${AGENT_TESTING_API_KEY:-sk-lh-agenttesting0001}"
QSTASH_DEV_PORT="${QSTASH_DEV_PORT:-8080}"
QSTASH_LOCAL_TOKEN="${QSTASH_LOCAL_TOKEN:-eyJVc2VySUQiOiJkZWZhdWx0VXNlciIsIlBhc3N3b3JkIjoiZGVmYXVsdFBhc3N3b3JkIn0=}"
QSTASH_LOCAL_CURRENT_SIGNING_KEY="${QSTASH_LOCAL_CURRENT_SIGNING_KEY:-sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r}"
QSTASH_LOCAL_NEXT_SIGNING_KEY="${QSTASH_LOCAL_NEXT_SIGNING_KEY:-sig_5ZB6DVzB1wjE8S6rZ7eenA8Pdnhs}"
S3_DEV_PORT="${S3_DEV_PORT:-29000}"
S3_DATA_DIR="${S3_DATA_DIR:-$WORKSPACE_ROOT/.records/data/agent-testing-s3}"

ok() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✘\033[0m %s\n' "$1"; }
note() { printf '      %s\n' "$1"; }

# A URL is "reachable" when it answers with any HTTP status. Connection refused
# / no route yields curl code 000. Used for the dev server, where any listener
# on the port is the thing we mean.
_http_reachable() {
  local url="$1" code
  command -v curl > /dev/null 2>&1 || return 2
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$url" 2>/dev/null || true)"
  [[ -n "$code" && "$code" != "000" ]]
}

# QStash-specific probe. 8080 is a common dev port, so "something answers HTTP"
# is not enough — a foreign listener would make preflight green while `agent
# run` later publishes to a non-QStash endpoint and fails. Key on QStash's REST
# contract instead: `/v2/schedules` rejects a tokenless request with 401 and
# answers the configured bearer with 200. A bare/foreign server fails one leg
# (catch-all 200 servers don't 401; 404/other servers don't 200), and a wrong
# token also fails (surfacing auth misconfig). Returns 2 when curl is absent.
_qstash_reachable() {
  command -v curl > /dev/null 2>&1 || return 2
  local base="${QSTASH_URL%/}" unauth auth
  unauth="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$base/v2/schedules" 2>/dev/null || true)"
  [[ "$unauth" == "401" ]] || return 1
  auth="$(curl -s -o /dev/null -m 3 \
    -H "Authorization: Bearer ${QSTASH_TOKEN:-}" \
    -w '%{http_code}' "$base/v2/schedules" 2>/dev/null || true)"
  [[ "$auth" == "200" ]]
}

guard_no_root_env() {
  if [[ -f "$ROOT_ENV_FILE" ]]; then
    bad "root .env exists: $ROOT_ENV_FILE"
    note "Use the existing local configuration instead of init-dev-env.sh."
    note "Start normally from repo root, e.g. pnpm run dev:next or bun run dev."
    exit 1
  fi
}

apply_env() {
  export AGENT_RUNTIME_MODE="${AGENT_RUNTIME_MODE:-queue}"
  export APP_URL="${APP_URL:-http://localhost:${SERVER_PORT}}"
  export AUTH_EMAIL_VERIFICATION="${AUTH_EMAIL_VERIFICATION:-0}"
  export AUTH_SECRET="${AUTH_SECRET:-agent-testing-local-auth-secret-32chars}"
  export DATABASE_DRIVER="${DATABASE_DRIVER:-node}"
  export DATABASE_URL
  export FEATURE_FLAGS="${FEATURE_FLAGS:--agent_self_iteration}"
  export KEY_VAULTS_SECRET="${KEY_VAULTS_SECRET:-r2gbBPKyJ8ZRKCLKt+I3DImfcL+wGxaQyRC56xtm9Uk=}"
  export NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION="${NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION:-0}"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
  export PORT="${PORT:-$SERVER_PORT}"
  export QSTASH_CURRENT_SIGNING_KEY="${QSTASH_CURRENT_SIGNING_KEY:-$QSTASH_LOCAL_CURRENT_SIGNING_KEY}"
  export QSTASH_DEV_PORT
  export QSTASH_NEXT_SIGNING_KEY="${QSTASH_NEXT_SIGNING_KEY:-$QSTASH_LOCAL_NEXT_SIGNING_KEY}"
  export QSTASH_TOKEN="${QSTASH_TOKEN:-$QSTASH_LOCAL_TOKEN}"
  export QSTASH_URL="${QSTASH_URL:-http://127.0.0.1:${QSTASH_DEV_PORT}}"
  export REDIS_URL
  export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-S3RVER}"
  export S3_BUCKET="${S3_BUCKET:-agent-testing-bucket}"
  export S3_DATA_DIR
  export S3_DEV_PORT
  export S3_ENABLE_PATH_STYLE="${S3_ENABLE_PATH_STYLE:-1}"
  export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:${S3_DEV_PORT}}"
  export S3_PUBLIC_DOMAIN="${S3_PUBLIC_DOMAIN:-${S3_ENDPOINT}/${S3_BUCKET}}"
  export S3_REGION="${S3_REGION:-us-east-1}"
  export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-S3RVER}"
  export S3_SET_ACL="${S3_SET_ACL:-0}"
  export SPA_PORT
  export VITE_DEV_PORT="${VITE_DEV_PORT:-$SPA_PORT}"
  # Bypass cloud chat-security UA/headless fingerprint checks for local e2e only.
  # Guarded by NODE_ENV !== 'production' inside detectSuspiciousRequest(), so it
  # can never weaken production. Lets headless agent-browser drive real chats.
  export AGENT_TESTING_DISABLE_CHAT_SECURITY="${AGENT_TESTING_DISABLE_CHAT_SECURITY:-1}"
}

env_keys() {
  printf '%s\n' \
    APP_URL \
    AGENT_RUNTIME_MODE \
    AUTH_EMAIL_VERIFICATION \
    AUTH_SECRET \
    DATABASE_DRIVER \
    DATABASE_URL \
    FEATURE_FLAGS \
    KEY_VAULTS_SECRET \
    NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION \
    NODE_OPTIONS \
    PORT \
    QSTASH_CURRENT_SIGNING_KEY \
    QSTASH_DEV_PORT \
    QSTASH_NEXT_SIGNING_KEY \
    QSTASH_TOKEN \
    QSTASH_URL \
    REDIS_URL \
    S3_ACCESS_KEY_ID \
    S3_BUCKET \
    S3_DATA_DIR \
    S3_DEV_PORT \
    S3_ENABLE_PATH_STYLE \
    S3_ENDPOINT \
    S3_PUBLIC_DOMAIN \
    S3_REGION \
    S3_SECRET_ACCESS_KEY \
    S3_SET_ACL \
    SPA_PORT \
    VITE_DEV_PORT \
    AGENT_TESTING_DISABLE_CHAT_SECURITY
}

print_env() {
  apply_env
  while IFS= read -r key; do
    printf 'export %s=%q\n' "$key" "${!key}"
  done < <(env_keys)
}

write_env() {
  local file="${1:-$ENV_FILE_DEFAULT}"
  apply_env
  mkdir -p "$(dirname "$file")"
  {
    printf '# Source this file before starting LobeHub local dev server.\n'
    printf '# Generated by %s\n' "$0"
    while IFS= read -r key; do
      printf 'export %s=%q\n' "$key" "${!key}"
    done < <(env_keys)
  } > "$file"
  ok "wrote env file: $file"
  note "source it with: source $file"
}

require_docker() {
  if ! command -v docker > /dev/null 2>&1; then
    bad "docker CLI is not available"
    note "Install/start Docker Desktop, or provide DATABASE_URL for an existing Postgres."
    return 1
  fi
}

wait_for_db() {
  printf '      waiting for Postgres'
  until docker exec "$DB_CONTAINER" pg_isready -U postgres > /dev/null 2>&1; do
    printf '.'
    sleep 2
  done
  printf '\n'
}

wait_for_redis() {
  printf '      waiting for Redis'
  until docker exec "$REDIS_CONTAINER" redis-cli ping > /dev/null 2>&1; do
    printf '.'
    sleep 1
  done
  printf '\n'
}

start_db() {
  require_docker

  if docker ps --format '{{.Names}}' | grep -Fxq "$DB_CONTAINER"; then
    ok "Postgres container already running: $DB_CONTAINER"
  elif docker ps -a --format '{{.Names}}' | grep -Fxq "$DB_CONTAINER"; then
    docker start "$DB_CONTAINER" > /dev/null
    ok "started existing Postgres container: $DB_CONTAINER"
  else
    docker run -d \
      --name "$DB_CONTAINER" \
      -e POSTGRES_PASSWORD=postgres \
      -p "${DB_PORT}:5432" \
      paradedb/paradedb:latest > /dev/null
    ok "created Postgres container: $DB_CONTAINER"
  fi

  wait_for_db
}

start_redis() {
  require_docker

  if docker ps --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
    ok "Redis container already running: $REDIS_CONTAINER"
  elif docker ps -a --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
    docker start "$REDIS_CONTAINER" > /dev/null
    ok "started existing Redis container: $REDIS_CONTAINER"
  else
    docker run -d \
      --name "$REDIS_CONTAINER" \
      -p "${REDIS_PORT}:6379" \
      redis:7-alpine > /dev/null
    ok "created Redis container: $REDIS_CONTAINER"
  fi

  wait_for_redis
}

migrate_db() {
  apply_env
  cd "$REPO_ROOT"
  bun run db:migrate
}

seed_user() {
  apply_env
  export AGENT_TESTING_API_KEY
  export AGENT_TESTING_CLI_ENV_FILE="${AGENT_TESTING_CLI_ENV_FILE:-$CLI_ENV_FILE_DEFAULT}"
  cd "$REPO_ROOT"
  node <<'NODE'
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the baseline test user.');
}

const TEST_USER = {
  email: 'agent-testing@lobehub.com',
  fullName: 'Agent Testing User',
  id: 'user_agent_testing_001',
  password: 'TestPassword123!',
  username: 'agent_testing_user',
};

const TEST_API_KEY = {
  id: 'api_key_agent_testing_001',
  key: process.env.AGENT_TESTING_API_KEY || 'sk-lh-agenttesting0001',
  name: 'Agent Testing CLI API Key',
};

const validateApiKeyFormat = (apiKey) => /^sk-lh-[\da-z]{16}$/.test(apiKey);

const hashApiKey = (apiKey) => {
  const secret = process.env.KEY_VAULTS_SECRET;
  if (!secret) throw new Error('KEY_VAULTS_SECRET is required to seed the baseline API key.');

  return crypto.createHmac('sha256', secret).update(apiKey).digest('hex');
};

const encryptWithKeyVaultsSecret = (plaintext) => {
  const secret = process.env.KEY_VAULTS_SECRET;
  if (!secret) throw new Error('KEY_VAULTS_SECRET is required to seed the baseline API key.');

  const rawKey = Buffer.from(secret, 'base64');
  if (![16, 24, 32].includes(rawKey.length)) {
    throw new Error(
      `KEY_VAULTS_SECRET must decode to 16, 24, or 32 bytes, got ${rawKey.length} bytes.`,
    );
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(`aes-${rawKey.length * 8}-gcm`, rawKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

const writeCliEnvFile = () => {
  const file = process.env.AGENT_TESTING_CLI_ENV_FILE || '.records/env/agent-testing-cli.env';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      '# Source this file before running LobeHub CLI agent tests.',
      '# Generated by init-dev-env.sh seed-user',
      `export LOBE_API_KEY=${TEST_API_KEY.key}`,
      `export LOBEHUB_CLI_API_KEY="${'${LOBE_API_KEY}'}"`,
      `export LOBEHUB_SERVER=${process.env.APP_URL}`,
      'export LOBEHUB_CLI_HOME=.lobehub-dev',
      '',
    ].join('\n'),
  );

  return file;
};

const client = new pg.Client({ connectionString: databaseUrl });

(async () => {
  if (!validateApiKeyFormat(TEST_API_KEY.key)) {
    throw new Error(`Invalid AGENT_TESTING_API_KEY format: ${TEST_API_KEY.key}`);
  }

  await client.connect();
  const now = new Date().toISOString();
  const onboarding = JSON.stringify({ finishedAt: now, version: 1 });
  const passwordHash = await bcrypt.hash(TEST_USER.password, 10);
  const encryptedApiKey = encryptWithKeyVaultsSecret(TEST_API_KEY.key);
  const apiKeyHash = hashApiKey(TEST_API_KEY.key);

  await client.query(
    `INSERT INTO users (id, email, normalized_email, username, full_name, email_verified, onboarding, created_at, updated_at, last_active_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)
     ON CONFLICT (id) DO UPDATE SET onboarding = $7, updated_at = $8`,
    [
      TEST_USER.id,
      TEST_USER.email,
      TEST_USER.email.toLowerCase(),
      TEST_USER.username,
      TEST_USER.fullName,
      true,
      onboarding,
      now,
    ],
  );

  await client.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT DO NOTHING`,
    [
      'agent_testing_account_001',
      TEST_USER.id,
      TEST_USER.email,
      'credential',
      passwordHash,
      now,
    ],
  );

  await client.query(
    `INSERT INTO api_keys (id, name, key, key_hash, enabled, expires_at, user_id, workspace_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL, $7, $7)
     ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name,
         key = EXCLUDED.key,
         key_hash = EXCLUDED.key_hash,
         enabled = EXCLUDED.enabled,
         expires_at = NULL,
         updated_at = EXCLUDED.updated_at`,
    [
      TEST_API_KEY.id,
      TEST_API_KEY.name,
      encryptedApiKey,
      apiKeyHash,
      true,
      TEST_USER.id,
      now,
    ],
  );

  const cliEnvFile = writeCliEnvFile();

  console.log('seeded baseline user:');
  console.log(`  email: ${TEST_USER.email}`);
  console.log(`  password: ${TEST_USER.password}`);
  console.log('seeded baseline API key:');
  console.log(`  LOBE_API_KEY: ${TEST_API_KEY.key}`);
  console.log(`  CLI env: ${cliEnvFile}`);
})()
  .finally(() => client.end())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
NODE
}

cmd_status() {
  apply_env
  echo "agent-testing local dev env:"
  note "APP_URL=$APP_URL"
  note "AGENT_RUNTIME_MODE=$AGENT_RUNTIME_MODE"
  note "DATABASE_URL=$DATABASE_URL"
  note "PORT=$PORT"
  note "QSTASH_URL=$QSTASH_URL"
  note "REDIS_URL=$REDIS_URL"
  if command -v docker > /dev/null 2>&1; then
    ok "docker CLI available"
    if docker ps --format '{{.Names}}' | grep -Fxq "$DB_CONTAINER"; then
      ok "managed Postgres running: $DB_CONTAINER"
    else
      note "managed Postgres is not running: $DB_CONTAINER"
    fi
    if docker ps --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
      ok "managed Redis running: $REDIS_CONTAINER"
    else
      note "managed Redis is not running: $REDIS_CONTAINER"
    fi
  else
    bad "docker CLI is not available"
  fi
  if _qstash_reachable; then
    ok "QStash reachable: $QSTASH_URL"
  else
    note "QStash is not answering as QStash at $QSTASH_URL (needed for agent-runtime / queue mode)"
  fi
  if node "$REPO_ROOT/.agents/verify/scripts/check-s3.mjs" > /dev/null 2>&1; then
    ok "S3 reachable and writable: $S3_ENDPOINT/$S3_BUCKET"
  else
    note "S3 is not ready at $S3_ENDPOINT (start it with: $0 s3)"
  fi
}

# Prerequisite gate for agent-runtime tests. In queue mode (the default here and
# in production) creating an agent operation POSTs to QStash; if QStash is down
# the run fails with `ECONNREFUSED 127.0.0.1:8080 / fetch failed` at operation
# creation — before any LLM call, so no trace is ever recorded. Run this before
# `lh agent run` (or any durable-op path) and start `qstash` if it fails.
cmd_preflight() {
  apply_env
  local failed=0
  echo "agent-runtime preflight (AGENT_RUNTIME_MODE=$AGENT_RUNTIME_MODE):"

  if command -v docker > /dev/null 2>&1 &&
    docker ps --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
    ok "Redis running: $REDIS_CONTAINER (queue-mode state)"
  else
    bad "Redis not running: $REDIS_CONTAINER"
    note "start it with: $0 setup-db"
    failed=1
  fi

  if [[ "$AGENT_RUNTIME_MODE" == "queue" ]]; then
    if _qstash_reachable; then
      ok "QStash reachable: $QSTASH_URL (operation dispatch)"
    else
      bad "QStash NOT answering as QStash at $QSTASH_URL — agent runs will fail with 'fetch failed' (ECONNREFUSED) or auth errors"
      note "start it in a separate terminal: $0 qstash"
      failed=1
    fi
  else
    note "AGENT_RUNTIME_MODE=$AGENT_RUNTIME_MODE (not queue) — QStash not required"
  fi

  if node "$REPO_ROOT/.agents/verify/scripts/check-s3.mjs" > /dev/null 2>&1; then
    ok "S3 read/write/delete passed: $S3_ENDPOINT/$S3_BUCKET"
  else
    bad "S3 preflight failed at $S3_ENDPOINT/$S3_BUCKET"
    note "start it in a separate terminal: $0 s3"
    failed=1
  fi

  if _http_reachable "$APP_URL"; then
    ok "dev server reachable: $APP_URL"
  else
    note "dev server not reachable at $APP_URL — start it with: $0 dev"
  fi

  if [[ "$failed" == 1 ]]; then
    bad "preflight failed — resolve the above before running agent-runtime tests"
    return 1
  fi
  ok "preflight passed — safe to run agent-runtime tests"
}

cmd_qstash() {
  apply_env
  cd "$REPO_ROOT"
  note "starting local QStash dev server at $QSTASH_URL"
  note "keep this process running while testing workflow paths"
  exec pnpm run qstash -- -port "$QSTASH_DEV_PORT"
}

process_start() {
  ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

write_dev_state() {
  local mode="$1" start
  start="$(process_start "$$")"
  mkdir -p "$(dirname "$DEV_STATE_FILE")"
  {
    printf 'PID=%q\n' "$$"
    printf 'PROCESS_START=%q\n' "$start"
    printf 'MODE=%q\n' "$mode"
    printf 'REPO_ROOT=%q\n' "$REPO_ROOT"
    printf 'SERVER_PORT=%q\n' "$SERVER_PORT"
    printf 'SPA_PORT=%q\n' "$SPA_PORT"
  } > "$DEV_STATE_FILE"
  note "recorded dev server ownership: $DEV_STATE_FILE (pid $$)"
}

prepare_dev_state() {
  local PID PROCESS_START MODE REPO_ROOT SERVER_PORT SPA_PORT
  [[ -f "$DEV_STATE_FILE" ]] || return 0
  # shellcheck disable=SC1090
  source "$DEV_STATE_FILE"
  if state_owns_process "$PID" "$PROCESS_START" "$REPO_ROOT" "$MODE"; then
    bad "an owned $MODE dev server is already running (pid $PID)"
    note "stop it first with: $0 stop-dev"
    return 1
  fi
  note "replacing stale dev ownership state: $DEV_STATE_FILE"
  rm -f "$DEV_STATE_FILE"
}

collect_descendants() {
  local parent="$1" child
  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    collect_descendants "$child"
    printf '%s\n' "$child"
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

state_owns_process() {
  local pid="$1" expected_start="$2" expected_root="$3" mode="$4"
  local actual_start actual_cwd command
  kill -0 "$pid" 2>/dev/null || return 1
  actual_start="$(process_start "$pid")"
  [[ -n "$actual_start" && "$actual_start" == "$expected_start" ]] || return 1
  actual_cwd="$(process_cwd "$pid")"
  [[ "$actual_cwd" == "$expected_root" || "$actual_cwd" == "$expected_root/"* ]] || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$mode" in
    dev) [[ "$command" == *"bun"* && "$command" == *"run dev"* ]] ;;
    dev-next) [[ "$command" == *"next"* && "$command" == *"dev"* ]] ;;
    *) return 1 ;;
  esac
}

stop_owned_process_tree() {
  local root_pid="$1" descendants pid
  descendants="$(collect_descendants "$root_pid")"
  for pid in $descendants; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  kill -TERM "$root_pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$root_pid" 2>/dev/null || return 0
    sleep 0.1
  done
  for pid in $descendants; do
    kill -KILL "$pid" 2>/dev/null || true
  done
  kill -KILL "$root_pid" 2>/dev/null || true
}

cmd_s3() {
  apply_env
  cd "$REPO_ROOT"
  note "starting local S3 server at $S3_ENDPOINT"
  note "bucket=$S3_BUCKET; data=$S3_DATA_DIR"
  note "keep this process running while testing file uploads"
  exec node .agents/verify/scripts/start-s3.mjs
}

cmd_dev_next() {
  apply_env
  cd "$REPO_ROOT"
  # Pass the allocated port explicitly. The submodule's `dev:next` package script
  # hard-codes `-p 3010`, so going through it would bind the wrong port whenever
  # SERVER_PORT was auto-allocated to something else. apply_env already exported
  # every env this needs (there is no .env to load in this mode), so invoking
  # next directly is equivalent and port-correct in both cloud and submodule.
  prepare_dev_state
  write_dev_state dev-next
  exec pnpm exec next dev -p "$SERVER_PORT"
}

cmd_dev() {
  apply_env
  cd "$REPO_ROOT"
  prepare_dev_state
  write_dev_state dev
  exec bun run dev
}

cmd_clean_db() {
  require_docker
  if docker ps --format '{{.Names}}' | grep -Fxq "$DB_CONTAINER"; then
    docker stop "$DB_CONTAINER" > /dev/null
  fi
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$DB_CONTAINER"; then
    docker rm "$DB_CONTAINER" > /dev/null
    ok "removed Postgres container: $DB_CONTAINER"
  else
    note "Postgres container not found: $DB_CONTAINER"
  fi
  if docker ps --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
    docker stop "$REDIS_CONTAINER" > /dev/null
  fi
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
    docker rm "$REDIS_CONTAINER" > /dev/null
    ok "removed Redis container: $REDIS_CONTAINER"
  else
    note "Redis container not found: $REDIS_CONTAINER"
  fi
}

cmd_stop_dev() {
  local PID PROCESS_START MODE REPO_ROOT SERVER_PORT SPA_PORT
  if [[ ! -f "$DEV_STATE_FILE" ]]; then
    note "no owned dev server state found: $DEV_STATE_FILE"
    return 0
  fi
  # shellcheck disable=SC1090
  source "$DEV_STATE_FILE"
  if ! state_owns_process "$PID" "$PROCESS_START" "$REPO_ROOT" "$MODE"; then
    bad "refusing to stop PID $PID: ownership metadata no longer matches the live process"
    note "stale state removed; inspect listeners manually if cleanup is still needed"
    rm -f "$DEV_STATE_FILE"
    return 1
  fi
  stop_owned_process_tree "$PID"
  rm -f "$DEV_STATE_FILE"
  ok "stopped owned $MODE process tree (root pid $PID)"
}

cmd_clean() {
  # Default teardown after a test run: stop the dev server. The managed
  # Postgres/Redis containers are intentionally reused across runs (setup-db is
  # idempotent), so they are left running — remove them explicitly with clean-db.
  cmd_stop_dev
  note "managed DB/Redis containers and S3 data left in place for reuse"
  note "remove DB/Redis with: $0 clean-db; remove S3 data with: $0 clean-s3"
}

cmd_clean_s3() {
  apply_env
  if [[ -d "$S3_DATA_DIR" ]]; then
    rm -rf "$S3_DATA_DIR"
    ok "removed local S3 data: $S3_DATA_DIR"
  else
    note "local S3 data not found: $S3_DATA_DIR"
  fi
}

usage() {
  sed -n '3,27p' "$0" >&2
}

COMMAND="${1:-status}"

case "$COMMAND" in
  help|-h|--help) usage; exit 0 ;;
  *) guard_no_root_env ;;
esac

case "$COMMAND" in
  env) print_env ;;
  write) shift; write_env "${1:-}" ;;
  setup-db)
    start_db
    start_redis
    migrate_db
    ;;
  migrate) migrate_db ;;
  seed-user) seed_user ;;
  qstash) cmd_qstash ;;
  s3) cmd_s3 ;;
  preflight) cmd_preflight ;;
  dev-next) cmd_dev_next ;;
  dev) cmd_dev ;;
  stop-dev | stop) cmd_stop_dev ;;
  clean) cmd_clean ;;
  clean-db) cmd_clean_db ;;
  clean-s3) cmd_clean_s3 ;;
  status) cmd_status ;;
  *)
    usage
    exit 2
    ;;
esac
