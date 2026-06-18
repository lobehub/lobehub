#!/usr/bin/env bash
# app-probe.sh — standardized probes for a running LobeHub app (Electron via
# CDP, or a web agent-browser session). Use these instead of hand-rolling
# `window.__LOBE_STORES` eval snippets — especially the auth check.
#
# Usage:
#   app-probe.sh auth              # { isSignedIn, userId } from the user store
#   app-probe.sh route             # current SPA route
#   app-probe.sh ops               # running chat operations (type / status / startTime)
#   app-probe.sh goto <path>       # navigate the SPA to a route (full reload), e.g. goto /agent/agt_xxx
#   app-probe.sh errors-install    # install a console.error interceptor
#   app-probe.sh errors            # dump errors captured since errors-install
#
# Target selection (default: Electron over CDP 9222):
#   AB_TARGET="--cdp 9222"             # Electron (default; CDP_PORT also honored)
#   AB_TARGET="--session lobehub-dev"  # web agent-browser session
#
# Common routes (desktop SPA): /  /agent/<agentId>  /agent/<agentId>/<topicId>
#   /task  /task/<taskId>  /page  /settings  /community

set -euo pipefail

AB_TARGET="${AB_TARGET:---cdp ${CDP_PORT:-9222}}"

run_eval() {
  # shellcheck disable=SC2086
  agent-browser $AB_TARGET eval --stdin
}

case "${1:-}" in
  auth)
    run_eval << 'EVALEOF'
(function () {
  var stores = window.__LOBE_STORES;
  if (!stores || !stores.user) return JSON.stringify({ ok: false, reason: 'no user store — app not loaded yet?' });
  var u = stores.user();
  return JSON.stringify({ ok: !!u.isSignedIn, isSignedIn: !!u.isSignedIn, userId: (u.user && u.user.id) || null });
})()
EVALEOF
    ;;
  route)
    run_eval << 'EVALEOF'
location.pathname + location.search + location.hash
EVALEOF
    ;;
  ops)
    run_eval << 'EVALEOF'
(function () {
  var stores = window.__LOBE_STORES;
  if (!stores || !stores.chat) return JSON.stringify({ ok: false, reason: 'no chat store — open a conversation first' });
  var ops = Object.values(stores.chat().operations || {});
  var running = ops.filter(function (o) { return o.status === 'running'; });
  return JSON.stringify({
    ok: true,
    running: running.map(function (o) { return { startTime: o.metadata && o.metadata.startTime, type: o.type }; }),
    runningCount: running.length,
    total: ops.length,
  });
})()
EVALEOF
    ;;
  goto)
    TARGET_PATH="${2:?Usage: app-probe.sh goto <path>}"
    # shellcheck disable=SC2086
    agent-browser $AB_TARGET eval "location.href = '$TARGET_PATH'" > /dev/null
    sleep 2
    bash "${BASH_SOURCE[0]}" route
    ;;
  errors-install)
    run_eval << 'EVALEOF'
(function () {
  window.__CAPTURED_ERRORS = [];
  var orig = console.error;
  console.error = function () {
    var msg = Array.from(arguments).map(function (a) {
      if (a instanceof Error) return a.message;
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    window.__CAPTURED_ERRORS.push(msg);
    orig.apply(console, arguments);
  };
  return 'installed';
})()
EVALEOF
    ;;
  errors)
    run_eval << 'EVALEOF'
JSON.stringify(window.__CAPTURED_ERRORS || 'interceptor not installed — run errors-install first')
EVALEOF
    ;;
  *)
    echo "Usage: $0 {auth|route|ops|goto <path>|errors-install|errors}" >&2
    exit 2
    ;;
esac
