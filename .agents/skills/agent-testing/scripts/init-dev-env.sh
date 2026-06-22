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
#   init-dev-env.sh dev-next         # exec `pnpm run dev:next` with this env
#   init-dev-env.sh dev              # exec `bun run dev` with this env
#   init-dev-env.sh clean-db         # remove the managed Postgres/Redis containers
#
# Overrides:
#   SERVER_PORT=3010 DB_PORT=5433 DB_CONTAINER=lobehub-agent-testing-postgres REDIS_PORT=6380 REDIS_CONTAINER=lobehub-agent-testing-redis QSTASH_DEV_PORT=8080

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ROOT_ENV_FILE="$REPO_ROOT/.env"

SERVER_PORT="${SERVER_PORT:-3010}"
DB_PORT="${DB_PORT:-5433}"
DB_CONTAINER="${DB_CONTAINER:-lobehub-agent-testing-postgres}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:${DB_PORT}/postgres}"
REDIS_PORT="${REDIS_PORT:-6380}"
REDIS_CONTAINER="${REDIS_CONTAINER:-lobehub-agent-testing-redis}"
REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
ENV_FILE_DEFAULT="$REPO_ROOT/.records/env/agent-testing-dev.env"
CLI_ENV_FILE_DEFAULT="$REPO_ROOT/.records/env/agent-testing-cli.env"
AGENT_TESTING_API_KEY="${AGENT_TESTING_API_KEY:-sk-lh-agenttesting0001}"
QSTASH_DEV_PORT="${QSTASH_DEV_PORT:-8080}"
QSTASH_LOCAL_TOKEN="${QSTASH_LOCAL_TOKEN:-eyJVc2VySUQiOiJkZWZhdWx0VXNlciIsIlBhc3N3b3JkIjoiZGVmYXVsdFBhc3N3b3JkIn0=}"
QSTASH_LOCAL_CURRENT_SIGNING_KEY="${QSTASH_LOCAL_CURRENT_SIGNING_KEY:-sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r}"
QSTASH_LOCAL_NEXT_SIGNING_KEY="${QSTASH_LOCAL_NEXT_SIGNING_KEY:-sig_5ZB6DVzB1wjE8S6rZ7eenA8Pdnhs}"

ok() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✘\033[0m %s\n' "$1"; }
note() { printf '      %s\n' "$1"; }

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
  export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-agent-testing-access-key}"
  export S3_BUCKET="${S3_BUCKET:-agent-testing-bucket}"
  export S3_ENDPOINT="${S3_ENDPOINT:-https://agent-testing-s3.localhost}"
  export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-agent-testing-secret-key}"
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
    S3_ENDPOINT \
    S3_SECRET_ACCESS_KEY
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
}

cmd_qstash() {
  apply_env
  cd "$REPO_ROOT"
  note "starting local QStash dev server at $QSTASH_URL"
  note "keep this process running while testing workflow paths"
  exec pnpm run qstash -- -port "$QSTASH_DEV_PORT"
}

cmd_dev_next() {
  apply_env
  cd "$REPO_ROOT"
  exec pnpm run dev:next
}

cmd_dev() {
  apply_env
  cd "$REPO_ROOT"
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

usage() {
  sed -n '3,24p' "$0" >&2
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
  dev-next) cmd_dev_next ;;
  dev) cmd_dev ;;
  clean-db) cmd_clean_db ;;
  status) cmd_status ;;
  *)
    usage
    exit 2
    ;;
esac
