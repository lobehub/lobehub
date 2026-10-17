#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
ENV_FILE="${LOBEHUB_EVAL_ENV:-$REPO_ROOT/docker-compose/eval/.env}"
CLI_ENV_FILE="$REPO_ROOT/.records/env/eval-harbor-cli.env"
TARGET="${1:-}"
CLI_MODE="${2:-}"
EVAL_REPO="${3:-}"
RUN_MODE="${4:-${LH_RUN_MODE:-agent}}"
SMOKE_DIR="$SCRIPT_DIR/smoke"
JOBS_DIR="$REPO_ROOT/.records/harbor/jobs"
JOB_NAME="smoke-$(date +%Y%m%d-%H%M%S)-$$"
JOB_DIR="$JOBS_DIR/$JOB_NAME"

usage() {
  printf 'Usage: %s <local|cloud> <checkout|npm> [absolute-eval-repository] [agent|task]\n' "$0"
}

if [[ "$TARGET" == '-h' || "$TARGET" == '--help' ]]; then
  usage
  exit 0
fi
[[ "$TARGET" == 'local' || "$TARGET" == 'cloud' ]] || { usage >&2; exit 2; }
[[ "$CLI_MODE" == 'checkout' || "$CLI_MODE" == 'npm' ]] || { usage >&2; exit 2; }
[[ "$RUN_MODE" == 'agent' || "$RUN_MODE" == 'task' ]] || { usage >&2; exit 2; }
if [[ -n "$EVAL_REPO" ]]; then
  [[ -d "$EVAL_REPO" ]] || { printf 'Eval repository does not exist: %s\n' "$EVAL_REPO" >&2; exit 2; }
  EVAL_REPO="$(cd -- "$EVAL_REPO" && pwd)"
  EVAL_ENV="$EVAL_REPO/.env"
  [[ -f "$EVAL_ENV" ]] || { printf 'Missing eval environment: %s\n' "$EVAL_ENV" >&2; exit 1; }
else
  EVAL_ENV=""
fi

set -a
if [[ "$TARGET" == 'local' ]]; then
  [[ -f "$ENV_FILE" ]] || { printf 'Missing %s; run the eval bootstrap script first.\n' "$ENV_FILE" >&2; exit 1; }
  [[ -f "$CLI_ENV_FILE" ]] || { printf 'Missing %s; run the eval bootstrap script first.\n' "$CLI_ENV_FILE" >&2; exit 1; }
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  # shellcheck disable=SC1090
  source "$CLI_ENV_FILE"
  if [[ -n "$EVAL_ENV" ]]; then
    # shellcheck disable=SC1090
    source "$EVAL_ENV"
  fi
  export LOBEHUB_CLI_API_KEY="${LOBEHUB_CLI_API_KEY:-${LOBE_API_KEY:-}}"
  export LOBEHUB_SERVER="${LH_SERVER_URL:-}"
  export AGENT_GATEWAY_URL="${HARBOR_AGENT_GATEWAY_URL:-}"
else
  [[ -n "$EVAL_ENV" ]] || { printf 'Cloud smoke requires an eval repository with a .env file.\n' >&2; exit 2; }
  # shellcheck disable=SC1090
  source "$EVAL_ENV"
fi
set +a

if [[ "$TARGET" == 'local' ]]; then
  if [[ -z "${LH_AGENT_ID:-}" ]]; then
    export LH_AGENT_SLUG="${LH_AGENT_SLUG:-inbox}"
  fi
else
  [[ -n "${LH_AGENT_ID:-}" ]] || {
    printf 'LH_AGENT_ID is required for cloud smoke.\n' >&2
    exit 1
  }
  unset LH_AGENT_SLUG
fi
[[ -n "${LOBEHUB_CLI_API_KEY:-}" ]] || { printf 'LOBEHUB_CLI_API_KEY is required for smoke.\n' >&2; exit 1; }

if [[ "$CLI_MODE" == 'checkout' ]]; then
  CLI_DIR="$REPO_ROOT/apps/cli"
  [[ -f "$CLI_DIR/package.json" && -f "$CLI_DIR/dist/index.js" ]] || {
    printf 'Missing local CLI build; run pnpm --dir apps/cli build.\n' >&2
    exit 1
  }
  export LH_CLI_SOURCE="host-dir:$CLI_DIR"
else
  export LH_CLI_SOURCE=system
fi

preflight_args=("$TARGET")
[[ -n "$EVAL_REPO" ]] && preflight_args+=("$EVAL_REPO")
bash "$SCRIPT_DIR/preflight.sh" "${preflight_args[@]}"
mkdir -p "$JOBS_DIR"

cd "$REPO_ROOT"
export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONDONTWRITEBYTECODE=1
harbor_args=(
  run
  --path "$SMOKE_DIR"
  --jobs-dir "$JOBS_DIR"
  --job-name "$JOB_NAME"
  --n-concurrent 1
  --no-delete
  --disable-verification
  --yes
  --agent lh.agent:LhInstalledAgent
  --agent-env 'LOBEHUB_CLI_API_KEY=${LOBEHUB_CLI_API_KEY}'
  --agent-env 'LH_CLI_SOURCE=${LH_CLI_SOURCE}'
  --agent-env 'LH_RUN_MODE=${LH_RUN_MODE}'
)
export LH_RUN_MODE="$RUN_MODE"
for key in LH_AGENT_ID LH_AGENT_SLUG LH_SERVER_URL LH_GATEWAY_URL AGENT_GATEWAY_URL LOBEHUB_SERVER LOBEHUB_WORKSPACE_ID; do
  [[ -n "${!key:-}" ]] && harbor_args+=(--agent-env "$key=\${$key}")
done
uv run --with 'harbor==0.23.0' harbor "${harbor_args[@]}"

RESULT_FILE="$JOB_DIR/result.json" node <<'NODE'
const fs = require('node:fs');
const pathModule = require('node:path');

const path = process.env.RESULT_FILE;
if (!fs.existsSync(path)) throw new Error(`Harbor did not write ${path}`);
const result = JSON.parse(fs.readFileSync(path, 'utf8'));
const stats = result.stats || {};
if (stats.n_completed_trials !== 1 || stats.n_errored_trials !== 0) {
  throw new Error(
    `Harbor smoke failed: completed=${stats.n_completed_trials ?? 0}, errored=${stats.n_errored_trials ?? 0}; inspect ${path}`,
  );
}

const jobDir = pathModule.dirname(path);
const agentLogs = fs
  .readdirSync(jobDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => pathModule.join(jobDir, entry.name, 'agent', 'agent-run.log'))
  .filter((candidate) => fs.existsSync(candidate));
if (agentLogs.length !== 1) {
  throw new Error(`Expected one Harbor smoke agent log, found ${agentLogs.length}; inspect ${jobDir}`);
}
const agentLog = fs.readFileSync(agentLogs[0], 'utf8');
if (!/^hello world\r?$/m.test(agentLog) || !/Agent finished/.test(agentLog)) {
  throw new Error(`Harbor smoke did not complete the hello-world agent run; inspect ${agentLogs[0]}`);
}
console.log(`Harbor smoke passed: ${path}`);
NODE
