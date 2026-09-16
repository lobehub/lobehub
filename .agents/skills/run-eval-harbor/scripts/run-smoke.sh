#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
ENV_FILE="${LOBEHUB_EVAL_ENV:-$REPO_ROOT/docker-compose/eval/.env}"
CLI_ENV_FILE="$REPO_ROOT/.records/env/eval-harbor-cli.env"
SMOKE_DIR="$SCRIPT_DIR/smoke"
JOBS_DIR="$REPO_ROOT/.records/harbor/jobs"
JOB_NAME="smoke-$(date +%Y%m%d-%H%M%S)-$$"
JOB_DIR="$JOBS_DIR/$JOB_NAME"

[[ -f "$ENV_FILE" ]] || { printf 'Missing %s; run the eval bootstrap script first.\n' "$ENV_FILE" >&2; exit 1; }
[[ -f "$CLI_ENV_FILE" ]] || { printf 'Missing %s; run the eval bootstrap script first.\n' "$CLI_ENV_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
# shellcheck disable=SC1090
source "$CLI_ENV_FILE"
set +a

export LH_CLI_SOURCE="host-dir:$REPO_ROOT/apps/cli"
export LOBEHUB_SERVER="$LH_SERVER_URL"
export AGENT_GATEWAY_URL="$HARBOR_AGENT_GATEWAY_URL"

bash "$SCRIPT_DIR/preflight.sh"
mkdir -p "$JOBS_DIR"

cd "$REPO_ROOT"
export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONDONTWRITEBYTECODE=1
uv run --with 'harbor==0.18.0' harbor run \
  --path "$SMOKE_DIR" \
  --jobs-dir "$JOBS_DIR" \
  --job-name "$JOB_NAME" \
  --n-concurrent 1 \
  --no-delete \
  --disable-verification \
  --yes \
  --agent lh.agent:LhInstalledAgent \
  --agent-env 'LH_AGENT_SLUG=${LH_AGENT_SLUG}' \
  --agent-env 'LH_SERVER_URL=${LH_SERVER_URL}' \
  --agent-env 'LH_GATEWAY_URL=${LH_GATEWAY_URL}' \
  --agent-env 'AGENT_GATEWAY_URL=${AGENT_GATEWAY_URL}' \
  --agent-env 'LOBEHUB_SERVER=${LOBEHUB_SERVER}' \
  --agent-env 'LOBEHUB_CLI_API_KEY=${LOBEHUB_CLI_API_KEY}' \
  --agent-env 'LH_CLI_SOURCE=${LH_CLI_SOURCE}'

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
