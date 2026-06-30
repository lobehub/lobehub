#!/usr/bin/env bash

set -u

usage() {
  cat <<'EOF'
Diagnose remote Claude Code execution on a device.

Usage:
  scripts/diagnose-remote-claude-code.sh [target-cwd]

Environment:
  TARGET_CWD               Working directory to test when no argument is given.
  APP_CWD                  App bundle cwd to simulate. Default: /Applications/LobeHub.app/Contents/MacOS
  CLAUDE_TIMEOUT_SECONDS   Timeout for each claude -p probe. Default: 30
  CLAUDE_DIAG_PROMPT       Probe prompt. Default: Reply with exactly: ok
  LOG_FILE                 Output log path. Default: $HOME/lobehub-remote-claude-code-diagnostic-<timestamp>.log

Examples:
  scripts/diagnose-remote-claude-code.sh /Users/yutengjing/playground
  TARGET_CWD=/Users/yutengjing/playground scripts/diagnose-remote-claude-code.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
log_file="${LOG_FILE:-$HOME/lobehub-remote-claude-code-diagnostic-${timestamp}.log}"
mkdir -p "$(dirname "$log_file")"
exec > >(tee "$log_file") 2>&1

target_cwd="${1:-${TARGET_CWD:-$(pwd -P)}}"
app_cwd="${APP_CWD:-/Applications/LobeHub.app/Contents/MacOS}"
timeout_seconds="${CLAUDE_TIMEOUT_SECONDS:-30}"
prompt="${CLAUDE_DIAG_PROMPT:-Reply with exactly: ok}"
user_name="${USER:-$(id -un 2>/dev/null || echo unknown)}"
overall_status=0

mark_failure() {
  overall_status=1
}

section() {
  echo
  echo "== $1 =="
}

run_with_timeout() {
  local seconds="$1"
  shift

  "$@" &
  local cmd_pid=$!

  (
    sleep "$seconds"
    if kill -0 "$cmd_pid" 2>/dev/null; then
      echo "TIMEOUT: command exceeded ${seconds}s; sending TERM to pid ${cmd_pid}" >&2
      kill -TERM "$cmd_pid" 2>/dev/null || true
      sleep 2
      kill -KILL "$cmd_pid" 2>/dev/null || true
    fi
  ) &
  local watchdog_pid=$!

  wait "$cmd_pid"
  local status=$?

  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true

  return "$status"
}

run_probe() {
  local title="$1"
  local cwd="$2"
  shift 2

  section "$title"

  if [[ ! -d "$cwd" ]]; then
    echo "SKIP: cwd does not exist: $cwd"
    return 0
  fi

  (
    cd "$cwd" || exit 2
    echo "cwd=$(pwd -P)"
    run_with_timeout "$timeout_seconds" "$@"
  )
  local status=$?
  echo "-- exit=$status"

  if [[ "$status" -ne 0 ]]; then
    mark_failure
  fi
}

section "basic"
echo "log_file=$log_file"
echo "date=$(date '+%Y-%m-%dT%H:%M:%S%z')"
echo "hostname=$(hostname)"
echo "whoami=$(whoami)"
echo "uname=$(uname -a)"
echo "HOME=$HOME"
echo "SHELL=${SHELL:-}"
echo "PWD=$(pwd -P)"
echo "PATH=$PATH"
echo "TARGET_CWD=$target_cwd"
echo "APP_CWD=$app_cwd"
echo "CLAUDE_TIMEOUT_SECONDS=$timeout_seconds"
echo "Note: this script avoids dumping the full environment because it can contain secrets."

section "cwd"
if [[ ! -d "$target_cwd" ]]; then
  echo "FAIL: target cwd does not exist: $target_cwd"
  exit 2
fi
(
  cd "$target_cwd" || exit 2
  echo "resolved_target_cwd=$(pwd -P)"
  echo "writable=$([[ -w . ]] && echo yes || echo no)"
)

section "claude binary"
claude_bin="$(command -v claude 2>/dev/null || true)"
if [[ -z "$claude_bin" ]]; then
  echo "FAIL: claude was not found in the current PATH"
  mark_failure
else
  echo "claude_bin=$claude_bin"
  claude --version || true
fi

section "claude auth state hints"
for path in "$HOME/.claude" "$HOME/.claude.json" "$HOME/.config/claude" "$HOME/Library/Application Support/Claude"; do
  if [[ -e "$path" ]]; then
    ls -ld "$path"
  else
    echo "missing: $path"
  fi
done
if command -v security >/dev/null 2>&1; then
  echo "default_keychain=$(security default-keychain 2>/dev/null || true)"
  echo "keychain_list:"
  security list-keychains 2>/dev/null || true
fi

section "lobehub process hints"
if command -v pgrep >/dev/null 2>&1; then
  pids="$(pgrep -f 'LobeHub|lobehub|lh connect' 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    echo "No matching LobeHub/lh process found."
  else
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && ps -p "$pid" -o pid= -o comm= 2>/dev/null || true
    done <<<"$pids"
  fi
else
  echo "pgrep not available."
fi

if [[ -n "$claude_bin" ]]; then
  run_probe "claude -p in target cwd" "$target_cwd" claude -p "$prompt"

  run_probe "claude -p with app-bundle cwd" "$app_cwd" claude -p "$prompt"

  run_probe "reduced launchd-style PATH resolves claude" "$target_cwd" env -i \
    HOME="$HOME" \
    USER="$user_name" \
    LOGNAME="$user_name" \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    CLAUDE_DIAG_PROMPT="$prompt" \
    /bin/zsh -f -c 'echo "PATH=$PATH"; echo "claude=$(command -v claude 2>/dev/null || true)"; claude -p "$CLAUDE_DIAG_PROMPT"'

  run_probe "explicit claude binary with reduced env" "$target_cwd" env -i \
    HOME="$HOME" \
    USER="$user_name" \
    LOGNAME="$user_name" \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    "$claude_bin" -p "$prompt"
fi

section "interpretation"
cat <<'EOF'
- If "claude -p in target cwd" fails, the user shell cannot run Claude Code in the requested project.
- If target cwd passes but app-bundle cwd fails, missing cwd can explain app-started remote failures.
- If only "reduced launchd-style PATH resolves claude" fails, the daemon likely lacks the user's shell PATH.
- If explicit claude binary fails under reduced env, HOME/keychain/auth context may differ from the user terminal.
- If all probes pass but the remote operation still hangs, inspect device daemon logs for the operationId and event stream.
EOF

echo
echo "done: log saved to $log_file"
exit "$overall_status"
