#!/usr/bin/env bash
# LobeHub adapter over the acceptance skill's resource guard.
#
# A run boots a browser, a dev server and type-check workers. Left alone they grow
# until the host swaps itself to a crawl and the client driving the run freezes —
# measured in this repository at 30.9 GB / 31.7 GB of swap with 867 MB free. The
# skill's guard owns the generic half of the fix: sample the host, tier it, and stop
# only what this run can prove it started. This wrapper owns the project half — the
# groups worth watching here, this repository's thresholds, and the run's state dir.
#
# Usage:
#   acceptance-guard.sh start                    start this run's sampler
#   acceptance-guard.sh claim <pid>...           register a process this run started
#   acceptance-guard.sh claim-browser [session]  claim the browser behind an agent-browser session
#   acceptance-guard.sh check [--json]           exit 0 green, 10 yellow, 20 red, 2 unknown/error
#   acceptance-guard.sh status [--json]          this run's recorded guard state
#   acceptance-guard.sh stop                     stop the sampler (teardown; always)
#
# Environment:
#   ACCEPTANCE_RUN_TAG     required. Names this run. Ownership of a process is proven
#                          by this tag or by an explicit claim, so it has to be
#                          specific enough not to appear in unrelated command lines.
#   ACCEPTANCE_GUARD_DIR   state directory (default: ${TMPDIR:-/tmp}/lobe-acceptance/guard/<tag>)
#   ACCEPTANCE_GUARD_YELLOW, ACCEPTANCE_GUARD_RED   override the thresholds
#   ACCEPTANCE_GUARD_SCRIPT   the skill's guard to wrap (test seam)
#
# The thresholds are host-level on purpose. The group patterns below also match other
# worktrees' servers and other runs' browsers — five such processes held ~20 GB here
# — so a group or total RSS cap would turn a merely busy machine red and stop a
# healthy run. macOS tiers on kernel memory pressure (three consecutive red samples
# before stop-owned); Linux uses the swap/free thresholds below. On macOS swap and
# free percentages are diagnostic only. The groups select what stop-owned may stop.
#
# Contract: .agents/skills/acceptance/references/resource-guard.md
set -uo pipefail

PROG='[acceptance-guard]'
fail() { echo "$PROG $*" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GUARD="${ACCEPTANCE_GUARD_SCRIPT:-$ROOT/.agents/skills/acceptance/scripts/resource-guard.sh}"

YELLOW="${ACCEPTANCE_GUARD_YELLOW:-swap=60,free=20}"
RED="${ACCEPTANCE_GUARD_RED:-swap=80,free=8}"

# The processes a LobeHub run is worth bounding. A pattern alone never grants
# ownership: only the run tag or an explicit claim does.
GUARD_GROUPS=(
  'browser=Google Chrome for Testing'
  'devserver=next-server|vite'
  'typecheck=tsgo'
)

RUN_TAG="${ACCEPTANCE_RUN_TAG:-}"
[ -n "$RUN_TAG" ] || fail "set ACCEPTANCE_RUN_TAG before running the guard"
case "$RUN_TAG" in
  *[!A-Za-z0-9._-]*) fail "ACCEPTANCE_RUN_TAG must be [A-Za-z0-9._-]+ (got: $RUN_TAG)" ;;
esac
# A short tag is a substring of unrelated command lines, which would hand this run
# ownership of processes it never started.
[ "${#RUN_TAG}" -ge 8 ] || fail "ACCEPTANCE_RUN_TAG must be at least 8 characters (got: $RUN_TAG)"

STATE_DIR="${ACCEPTANCE_GUARD_DIR:-${TMPDIR:-/tmp}/lobe-acceptance/guard/$RUN_TAG}"
[ -f "$GUARD" ] || fail "the acceptance skill is not installed at $GUARD (run: lh acceptance install)"
# `claim` is what lets this adapter prove a browser or dev server is ours. An older
# installed skill has no such mode, and wiring it would leave a guard that can never
# stop anything on this repository.
case "$(bash "$GUARD" --help 2>&1 || true)" in
  *claim*) ;;
  *) fail "$GUARD has no 'claim' mode — update the installed skill (lh acceptance update) first" ;;
esac

guard() {
  local sub="$1"
  shift
  local args=("$sub" '--state-dir' "$STATE_DIR" '--run-tag' "$RUN_TAG")
  local group
  for group in "${GUARD_GROUPS[@]}"; do args+=('--group' "$group"); done
  bash "$GUARD" "${args[@]}" "$@"
}

case "${1:-}" in
  start)
    shift
    guard start --yellow "$YELLOW" --red "$RED" --on-red stop-owned "$@"
    ;;
  check)
    shift
    # The one-shot verdict must tier on the same thresholds as the watcher, or a run
    # reads one tier from `check` and is acted on by another.
    guard check --yellow "$YELLOW" --red "$RED" "$@"
    ;;
  status)
    shift
    guard status "$@"
    ;;
  stop)
    shift
    guard stop "$@"
    ;;
  claim)
    shift
    [ $# -gt 0 ] || fail "claim needs at least one pid: acceptance-guard.sh claim <pid>..."
    pids=()
    for pid in "$@"; do pids+=('--pid' "$pid"); done
    guard claim "${pids[@]}"
    ;;
  claim-browser)
    shift
    session="${1:-}"
    if [ -n "$session" ]; then
      url="$(agent-browser --session "$session" get cdp-url 2>/dev/null | tail -n 1)"
    else
      url="$(agent-browser get cdp-url 2>/dev/null | tail -n 1)"
    fi
    [ -n "$url" ] || fail "no CDP url — no agent-browser session is open yet"
    port="$(printf '%s' "$url" | sed -E 's|^ws://[^:]+:([0-9]+)/.*$|\1|')"
    case "$port" in '' | *[!0-9]*) fail "could not read a CDP port from '$url'" ;; esac
    # The session's CDP port is the one identifier agent-browser gives us that ties a
    # browser to this run: its profile is a random temp dir and named sessions keep no
    # pid file, so the listening process is the positive answer, not a guess.
    pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1)"
    [ -n "$pid" ] || fail "nothing is listening on CDP port $port"
    guard claim --pid "$pid"
    printf '%s browser pid %s (cdp %s) belongs to %s\n' "$PROG" "$pid" "$port" "$RUN_TAG"
    ;;
  *)
    fail "Usage: acceptance-guard.sh start|claim|claim-browser|check|status|stop"
    ;;
esac
