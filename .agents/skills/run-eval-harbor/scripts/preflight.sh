#!/usr/bin/env bash

set -u -o pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${LOBEHUB_REPO:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)}"
ENV_FILE="${LOBEHUB_EVAL_ENV:-${REPO_ROOT}/docker-compose/eval/.env}"
TARGET="${1:-}"
HARBOR_REPO="${2:-}"
COMPOSE_FILE="${REPO_ROOT}/docker-compose/eval/docker-compose.yml"
CURL_IMAGE="curlimages/curl:8.17.0"
JWKS_FILE="$REPO_ROOT/.records/env/agent-testing-jwks.json"

if [[ "$TARGET" == '-h' || "$TARGET" == '--help' ]]; then
  printf 'Usage: %s <local|cloud> [absolute-eval-repository]\n' "$0"
  exit 0
fi
if [[ "$TARGET" != 'local' && "$TARGET" != 'cloud' ]]; then
  printf 'Usage: %s <local|cloud> [absolute-eval-repository]\n' "$0" >&2
  exit 2
fi
if [[ -n "$HARBOR_REPO" && ! -d "$HARBOR_REPO" ]]; then
  printf 'FAIL target eval repository does not exist: %s\n' "$HARBOR_REPO" >&2
  exit 2
fi
if [[ -n "$HARBOR_REPO" ]]; then
  HARBOR_REPO="$(cd -- "$HARBOR_REPO" && pwd)"
  HARBOR_ENV="$HARBOR_REPO/.env"
else
  HARBOR_ENV=""
fi
if [[ "$TARGET" == 'cloud' && -z "$HARBOR_ENV" ]]; then
  printf 'FAIL cloud preflight requires an eval repository with a .env file\n' >&2
  exit 2
fi

passes=0
failures=0

pass() {
  passes=$((passes + 1))
  printf 'PASS %s\n' "$*"
}

fail() {
  failures=$((failures + 1))
  printf 'FAIL %s\n' "$*" >&2
}

section() {
  printf '\n%s\n' "$*"
}

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "command available: $1"
  else
    fail "missing command: $1"
  fi
}

read_dotenv() {
  local key="$1"
  local file="${2:-$ENV_FILE}"
  [[ -f "$file" ]] || return 0
  python3 - "$key" "$file" <<'PY'
from pathlib import Path
import sys

key, path = sys.argv[1], Path(sys.argv[2])
for raw in path.read_text(errors="ignore").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    if line.startswith("export "):
        line = line[len("export "):].strip()
    name, value = line.split("=", 1)
    if name.strip() == key:
        print(value.strip().strip("'\""))
        break
PY
}

require_env() {
  local key="$1"
  local file="${2:-$ENV_FILE}"
  if [[ -n "$(read_dotenv "$key" "$file")" ]]; then
    pass "$key is configured"
  else
    fail "$key is missing in $file"
  fi
}

expect_env() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(read_dotenv "$key")"
  if [[ "$actual" == "$expected" ]]; then
    pass "$key has the required value"
  else
    fail "$key must be $expected"
  fi
}

http_probe() {
  local label="$1"
  local url="$2"
  local header="${3:-}"
  local args=(-L -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 10)
  [[ -n "$header" ]] && args+=(-H "$header")
  local code
  code="$(curl "${args[@]}" "$url" 2>/dev/null || true)"
  if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
    pass "$label reachable ($code)"
  else
    fail "$label unreachable or unhealthy ($url, HTTP ${code:-000})"
  fi
}

container_probe() {
  local label="$1"
  local url="$2"
  local output
  output="$(docker run --rm "$CURL_IMAGE" -sS -o /dev/null -w '%{http_code}' \
    --connect-timeout 3 --max-time 10 "$url" 2>/dev/null || true)"
  if [[ "$output" =~ ^[23][0-9][0-9]$ ]]; then
    pass "$label reachable from Docker ($output)"
  else
    fail "$label unreachable from Docker ($url, HTTP ${output:-000})"
  fi
}

compose_id() {
  local service="$1"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -a -q "$service" 2>/dev/null | head -n 1
}

if [[ "$TARGET" == 'cloud' ]]; then
  section 'Cloud target configuration'
  [[ -f "$HARBOR_ENV" ]] && pass "eval env: $HARBOR_ENV" || fail "missing eval env: $HARBOR_ENV"
  for command in docker curl python3; do
    need_cmd "$command"
  done
  docker info >/dev/null 2>&1 && pass 'Docker daemon is available' || fail 'Docker daemon is unavailable'
  cloud_lh_server="$(read_dotenv LH_SERVER_URL "$HARBOR_ENV")"
  cloud_cli_server="$(read_dotenv LOBEHUB_SERVER "$HARBOR_ENV")"
  if [[ -n "$cloud_lh_server" && -n "$cloud_cli_server" && "$cloud_lh_server" != "$cloud_cli_server" ]]; then
    fail 'LH_SERVER_URL and LOBEHUB_SERVER must match when both are set'
  fi
  cloud_server="${cloud_lh_server:-${cloud_cli_server:-https://app.lobehub.com}}"
  cloud_device_gateway="$(read_dotenv LH_GATEWAY_URL "$HARBOR_ENV")"
  cloud_agent_gateway="$(read_dotenv AGENT_GATEWAY_URL "$HARBOR_ENV")"

  if [[ "$cloud_server" == 'https://app.lobehub.com' ]]; then
    cloud_device_gateway="${cloud_device_gateway:-https://device-gateway.lobehub.com}"
    cloud_agent_gateway="${cloud_agent_gateway:-https://agent-gateway.lobehub.com}"
  else
    [[ -n "$cloud_device_gateway" ]] || fail 'custom remote server requires LH_GATEWAY_URL'
    [[ -n "$cloud_agent_gateway" ]] || fail 'custom remote server requires AGENT_GATEWAY_URL'
  fi

  section 'Cloud service health'
  http_probe 'LobeHub cloud server' "${cloud_server%/}/api/version"
  container_probe 'LobeHub cloud server' "${cloud_server%/}/api/version"
  if [[ -n "$cloud_device_gateway" ]]; then
    http_probe 'Device Gateway' "${cloud_device_gateway%/}/health"
    container_probe 'Device Gateway' "${cloud_device_gateway%/}/health"
  fi
  if [[ -n "$cloud_agent_gateway" ]]; then
    http_probe 'Agent Gateway' "${cloud_agent_gateway%/}/health"
    container_probe 'Agent Gateway' "${cloud_agent_gateway%/}/health"
  fi

  section 'Summary'
  printf 'Passes: %d\nFailures: %d\n' "$passes" "$failures"
  if ((failures > 0)); then
    exit 1
  fi
  exit 0
fi

section 'Files and commands'
[[ -n "$REPO_ROOT" && -f "$REPO_ROOT/package.json" ]] && pass "LobeHub repo: $REPO_ROOT" || fail 'cannot resolve the LobeHub repository root'
[[ -f "$ENV_FILE" ]] && pass "eval env: $ENV_FILE" || fail "missing $ENV_FILE; copy .env.example first"
[[ -f "$COMPOSE_FILE" ]] && pass "Compose file: $COMPOSE_FILE" || fail "missing Compose file: $COMPOSE_FILE"

for command in docker curl python3 node ss; do
  need_cmd "$command"
done

if ! docker info >/dev/null 2>&1; then
  fail 'Docker daemon is unavailable'
fi

if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet >/dev/null 2>&1; then
  pass 'Compose configuration is valid'
else
  fail 'Compose configuration is invalid'
fi

section 'Production LobeHub contract'
expect_env APP_URL http://localhost:3210
expect_env INTERNAL_APP_URL http://localhost:3210
expect_env EVAL_LOBE_API_BASE_URL http://host.docker.internal:3210
expect_env DATABASE_DRIVER node
expect_env AGENT_RUNTIME_BASE_URL http://localhost:3210
expect_env AGENT_RUNTIME_MODE queue
expect_env DEVICE_GATEWAY_URL http://localhost:8787
expect_env AGENT_GATEWAY_URL http://localhost:8788
expect_env NEXT_PUBLIC_SERVICE_MODE server
expect_env TB_GRAPH_AGENT 1
expect_env ENABLE_AGENT_FILE_TRACING 1
expect_env ENABLE_AGENT_GATEWAY 1

for key in \
  DATABASE_URL REDIS_URL S3_ENDPOINT S3_BUCKET QSTASH_URL QSTASH_TOKEN \
  QSTASH_CURRENT_SIGNING_KEY QSTASH_NEXT_SIGNING_KEY DEVICE_GATEWAY_URL \
  DEVICE_GATEWAY_SERVICE_TOKEN AGENT_GATEWAY_URL AGENT_GATEWAY_SERVICE_TOKEN \
  AGENT_RUNTIME_BASE_URL KEY_VAULTS_SECRET AUTH_SECRET LH_SERVER_URL \
  LH_GATEWAY_URL HARBOR_AGENT_GATEWAY_URL; do
  require_env "$key"
done

[[ -s "$JWKS_FILE" ]] && pass 'eval JWKS private key exists' || fail "missing $JWKS_FILE; run the eval bootstrap script"

gateway_token="$(read_dotenv EVAL_GATEWAY_SERVICE_TOKEN)"
device_token="$(read_dotenv DEVICE_GATEWAY_SERVICE_TOKEN)"
agent_token="$(read_dotenv AGENT_GATEWAY_SERVICE_TOKEN)"
if [[ -n "$gateway_token" && "$gateway_token" == "$device_token" && "$gateway_token" == "$agent_token" ]]; then
  pass 'unified gateway service tokens match'
else
  fail 'EVAL_GATEWAY_SERVICE_TOKEN must match both LobeHub gateway tokens'
fi

section 'Compose services'
for service in postgresql redis rustfs qstash gateway; do
  id="$(compose_id "$service")"
  if [[ -z "$id" ]]; then
    fail "$service container does not exist"
    continue
  fi
  status="$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || true)"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || true)"
  if [[ "$status" == 'running' && "$health" != 'unhealthy' ]]; then
    pass "$service running (health: $health)"
  else
    fail "$service not ready (status: ${status:-unknown}, health: ${health:-unknown})"
  fi
done

init_id="$(compose_id rustfs-init)"
init_exit="$(docker inspect -f '{{.State.ExitCode}}' "$init_id" 2>/dev/null || true)"
[[ -n "$init_id" && "$init_exit" == '0' ]] && pass 'rustfs-init completed' || fail "rustfs-init failed or missing (exit: ${init_exit:-unknown})"

gateway_id="$(compose_id gateway)"
gateway_jwks="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$gateway_id" 2>/dev/null | sed -n 's/^JWKS_PUBLIC_KEY=//p' | head -n 1)"
expected_gateway_jwks="$(JWKS_FILE="$JWKS_FILE" node <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const privateJwks = JSON.parse(fs.readFileSync(process.env.JWKS_FILE, 'utf8'));
const privateFields = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi']);
const keys = privateJwks.keys.map((key) =>
  Object.fromEntries(Object.entries(key).filter(([name]) => !privateFields.has(name))),
);
process.stdout.write(JSON.stringify({ keys }));
NODE
)"
if [[ -n "$gateway_jwks" && "$gateway_jwks" == "$expected_gateway_jwks" ]]; then
  pass 'Gateway JWKS matches the production server signing key'
else
  fail 'Gateway JWKS is missing or does not match the production server signing key'
fi

postgres_id="$(compose_id postgresql)"
postgres_db="$(read_dotenv EVAL_POSTGRES_DB)"
postgres_db="${postgres_db:-lobechat}"
extensions="$(docker exec "$postgres_id" psql -U postgres -d "$postgres_db" -Atqc \
  "select extname from pg_extension where extname in ('pg_search','vector') order by extname" 2>/dev/null | tr '\n' ' ' || true)"
if [[ "$extensions" == *pg_search* && "$extensions" == *vector* ]]; then
  pass "PostgreSQL extensions installed: $extensions"
else
  fail 'PostgreSQL migrations have not installed pg_search and vector'
fi

redis_id="$(compose_id redis)"
if [[ -n "$redis_id" ]] && docker exec "$redis_id" redis-cli ping 2>/dev/null | grep -qx PONG; then
  pass 'Redis responds to PING'
else
  fail 'Redis does not respond to PING'
fi

section 'Host endpoints'
rustfs_port="$(read_dotenv EVAL_RUSTFS_PORT)"
device_port="$(read_dotenv EVAL_DEVICE_GATEWAY_PORT)"
agent_port="$(read_dotenv EVAL_AGENT_GATEWAY_PORT)"
qstash_url="$(read_dotenv QSTASH_URL)"
qstash_token="$(read_dotenv QSTASH_TOKEN)"
http_probe 'RustFS' "http://localhost:${rustfs_port:-9100}/health"
http_probe 'Device Gateway' "http://localhost:${device_port:-8787}/health"
http_probe 'Agent Gateway' "http://localhost:${agent_port:-8788}/health"
http_probe 'QStash API' "${qstash_url%/}/v2/logs" "Authorization: Bearer $qstash_token"
http_probe 'LobeHub production server' 'http://localhost:3210/api/version'

if [[ -f "$REPO_ROOT/.next/BUILD_ID" ]]; then
  pass 'LobeHub production build exists'
else
  fail 'missing .next/BUILD_ID; build before starting the production server'
fi

server_pid="$(ss -ltnp 'sport = :3210' 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)"
if [[ -n "$server_pid" ]]; then
  pass "port 3210 listener found (pid: $server_pid)"
  server_cwd="$(readlink -f "/proc/$server_pid/cwd" 2>/dev/null || true)"
  if [[ "$server_cwd" == "$REPO_ROOT" ]]; then
    pass 'port 3210 process runs from this checkout'
  else
    fail "port 3210 process cwd must be $REPO_ROOT"
  fi

  server_node_env="$(tr '\0' '\n' <"/proc/$server_pid/environ" 2>/dev/null | sed -n 's/^NODE_ENV=//p' | head -n 1 || true)"
  if [[ "$server_node_env" == 'production' ]]; then
    pass 'port 3210 process uses NODE_ENV=production'
  else
    fail 'port 3210 is not a verified production LobeHub process'
  fi

  if tr '\0' '\n' <"/proc/$server_pid/environ" 2>/dev/null | grep -q '^JWKS_KEY=.'; then
    pass 'production server has JWKS_KEY'
  else
    fail 'production server is missing JWKS_KEY'
  fi
else
  fail 'cannot identify the process listening on port 3210'
fi

lh_server_url="$(read_dotenv LH_SERVER_URL)"
lh_gateway_url="$(read_dotenv LH_GATEWAY_URL)"
harbor_agent_gateway_url="$(read_dotenv HARBOR_AGENT_GATEWAY_URL)"

section 'Harbor configuration'
if [[ -n "$HARBOR_ENV" ]]; then
  pass "external eval repo: $HARBOR_REPO"
  [[ -f "$HARBOR_ENV" ]] && pass "eval repo env: $HARBOR_ENV" || fail 'target eval repository is missing .env'
  for key in LH_SERVER_URL LH_GATEWAY_URL AGENT_GATEWAY_URL; do
    require_env "$key" "$HARBOR_ENV"
  done
  harbor_server="$(read_dotenv LH_SERVER_URL "$HARBOR_ENV")"
  harbor_device_gateway="$(read_dotenv LH_GATEWAY_URL "$HARBOR_ENV")"
  harbor_agent_gateway="$(read_dotenv AGENT_GATEWAY_URL "$HARBOR_ENV")"
  [[ -z "$(read_dotenv LH_AGENT_RUN_SSE "$HARBOR_ENV")" ]] && pass 'eval repo uses gateway mode' || fail 'unset LH_AGENT_RUN_SSE when AGENT_GATEWAY_URL is configured'
else
  pass 'using repository-level Harbor smoke configuration'
  harbor_server="$lh_server_url"
  harbor_device_gateway="$lh_gateway_url"
  harbor_agent_gateway="$harbor_agent_gateway_url"
fi

[[ "$harbor_server" == "$lh_server_url" ]] && pass 'eval repo LH_SERVER_URL matches harness' || fail 'eval repo LH_SERVER_URL differs from harness'
[[ "$harbor_device_gateway" == "$lh_gateway_url" ]] && pass 'eval repo LH_GATEWAY_URL matches harness' || fail 'eval repo LH_GATEWAY_URL differs from harness'
[[ "$harbor_agent_gateway" == "$harbor_agent_gateway_url" ]] && pass 'eval repo AGENT_GATEWAY_URL matches harness' || fail 'eval repo AGENT_GATEWAY_URL differs from harness'

section 'Harbor container reachability'
[[ "$lh_server_url" == *:3210 ]] && pass 'LH_SERVER_URL targets port 3210' || fail 'LH_SERVER_URL must target production port 3210'
container_probe 'LobeHub' "${lh_server_url%/}/api/version"
container_probe 'Device Gateway' "${lh_gateway_url%/}/health"
container_probe 'Agent Gateway' "${harbor_agent_gateway_url%/}/health"

section 'Summary'
printf 'Passes: %d\nFailures: %d\n' "$passes" "$failures"
((failures == 0))
