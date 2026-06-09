#!/usr/bin/env bash
#
# test-imessage-bridge.sh — Regression test for the iMessage Desktop bridge
#
# Drives the Electron main-process `imessageBridge.*` IPC handlers plus the
# local bridge HTTP server and the BlueBubbles server, asserting the full
# connect/configure flow. Use it to regression-test PR work on the iMessage
# channel (BlueBubbles bridge) without clicking through the UI every time.
#
# Prerequisites:
#   1. BlueBubbles server running and reachable (default http://127.0.0.1:1234)
#   2. Electron dev running with CDP — `electron-dev.sh start`
#   3. `agent-browser` on PATH, connected to the same CDP port
#
# Usage:
#   ./test-imessage-bridge.sh <bluebubbles_password> [bb_url] [cdp_port]
#
# Example:
#   ./test-imessage-bridge.sh 'my-bb-password'
#   ./test-imessage-bridge.sh 'my-bb-password' http://127.0.0.1:1234 9222
#
# Notes:
#   - The password is passed as an argv, so it is visible in `ps`. This is a
#     local dev tool; do not run it on shared machines with a real secret.
#   - It uses a unique applicationId per run (imsg-regression-$$) and cleans up
#     its own bridge config + BlueBubbles webhook on exit, so it is safe to
#     re-run and does not disturb real configs.
set -euo pipefail

BB_PASS="${1:?Usage: $0 <bluebubbles_password> [bb_url] [cdp_port]}"
BB_URL="${2:-http://127.0.0.1:1234}"
CDP_PORT="${3:-9222}"

APP_ID="imsg-regression-$$"
SECRET="regression-secret-$$"

PASS=0
FAIL=0

# ── Output helpers ───────────────────────────────────────────────────
ok()   { echo "  ✓ $1"; PASS=$((PASS + 1)); }
bad()  { echo "  ✗ $1 — $2"; FAIL=$((FAIL + 1)); }
note() { echo "[imsg-test] $1"; }

# ── BlueBubbles REST helpers ─────────────────────────────────────────
bb_get_webhooks() {
  curl -sS -m 8 "${BB_URL}/api/v1/webhook?password=${BB_PASS}"
}

# Delete every webhook whose URL mentions our APP_ID (cleanup is idempotent).
bb_cleanup_webhooks() {
  local ids
  ids=$(bb_get_webhooks | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for w in (d.get("data") or []):
    if "'"$APP_ID"'" in (w.get("url") or ""): print(w["id"])
' 2>/dev/null || true)
  for id in $ids; do
    curl -sS -m 8 -X DELETE "${BB_URL}/api/v1/webhook/${id}?password=${BB_PASS}" >/dev/null 2>&1 || true
  done
}

# ── IPC helper (drives the Electron renderer's electronAPI bridge) ───
# Runs a JS snippet that returns a string token; prints the raw token.
# The BlueBubbles password is base64-injected (atob) so special chars in the
# secret never need shell/JS quoting.
ipc_eval() {
  local js="$1"
  agent-browser --cdp "$CDP_PORT" eval -b "$(printf '%s' "$js" | base64)" 2>/dev/null
}

PASS_B64=$(printf '%s' "$BB_PASS" | base64)

# Emit an inline JS object literal for the bridge config. $1 overrides the
# password expression (defaults to atob of the real password); pass a JS string
# literal like "'wrong'" to test the rejection path.
ipc_config_js() {
  local pwexpr="${1:-atob('${PASS_B64}')}"
  printf "{applicationId:'%s',blueBubblesServerUrl:'%s',blueBubblesPassword:%s,enabled:true,webhookSecret:'%s'}" \
    "$APP_ID" "$BB_URL" "$pwexpr" "$SECRET"
}

# ── Preflight ────────────────────────────────────────────────────────
note "BlueBubbles: ${BB_URL}   CDP: ${CDP_PORT}   appId: ${APP_ID}"

code=$(curl -sS -m 6 -o /dev/null -w '%{http_code}' \
  "${BB_URL}/api/v1/server/info?password=${BB_PASS}" || echo 000)
if [ "$code" = "200" ]; then ok "BlueBubbles reachable + password valid"; else
  bad "BlueBubbles preflight" "HTTP $code (is BlueBubbles running on ${BB_URL}?)"
  echo "Aborting — fix BlueBubbles first."; exit 1
fi

if ! curl -sf --max-time 3 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  bad "Electron CDP preflight" "CDP ${CDP_PORT} unreachable — run electron-dev.sh start"
  echo "Aborting."; exit 1
fi
ok "Electron CDP reachable"

# Bridge must expose the IPC group (built from this branch's code).
probe=$(ipc_eval "(async()=>{try{var s=await window.electronAPI.invoke('imessageBridge.getStatus',{});return 'OK:'+JSON.stringify(s);}catch(e){return 'ERR:'+(e.message||e);}})()")
case "$probe" in
  *OK:*) ok "imessageBridge IPC available" ;;
  *) bad "imessageBridge IPC" "got: $probe (is the iMessage Desktop branch checked out?)"; echo "Aborting."; exit 1 ;;
esac

# Start clean: remove any leftover config for this appId + BB webhooks.
ipc_eval "(async()=>{try{await window.electronAPI.invoke('imessageBridge.removeConfig',{applicationId:'${APP_ID}'});}catch(e){}return 'done';})()" >/dev/null
bb_cleanup_webhooks

# ── testConfig: happy path ───────────────────────────────────────────
r=$(ipc_eval "(async()=>{try{var c=$(ipc_config_js);var x=await window.electronAPI.invoke('imessageBridge.testConfig',c);return 'OK:'+JSON.stringify(x);}catch(e){return 'ERR:'+(e.message||e);}})()")
case "$r" in
  *OK:*success*true*) ok "testConfig with valid password → success" ;;
  *) bad "testConfig (valid)" "got: $r" ;;
esac

# ── testConfig: wrong password rejects ───────────────────────────────
r=$(ipc_eval "(async()=>{try{var c=$(ipc_config_js "'definitely-wrong-password'");var x=await window.electronAPI.invoke('imessageBridge.testConfig',c);return 'OK:'+JSON.stringify(x);}catch(e){return 'ERR:'+(e.message||e);}})()")
case "$r" in
  *ERR:*) ok "testConfig with wrong password → rejected" ;;
  *) bad "testConfig (wrong password)" "expected rejection, got: $r" ;;
esac

# ── testConfig: unreachable URL rejects ──────────────────────────────
r=$(ipc_eval "(async()=>{try{var x=await window.electronAPI.invoke('imessageBridge.testConfig',{applicationId:'${APP_ID}',blueBubblesServerUrl:'http://127.0.0.1:65530',blueBubblesPassword:atob('${PASS_B64}'),enabled:true,webhookSecret:'${SECRET}'});return 'OK:'+JSON.stringify(x);}catch(e){return 'ERR:'+(e.message||e);}})()")
case "$r" in
  *ERR:*) ok "testConfig with unreachable URL → rejected" ;;
  *) bad "testConfig (unreachable)" "expected rejection, got: $r" ;;
esac

# ── upsertConfig: FIRST-TIME registration (Bug #1 regression guard) ──
# BlueBubbles' GET /webhook?url=<unregistered> returns HTTP 500. The bridge
# must list ALL webhooks and match client-side, otherwise this first save
# fails. This assertion guards that fix.
r=$(ipc_eval "(async()=>{try{var c=$(ipc_config_js);var x=await window.electronAPI.invoke('imessageBridge.upsertConfig',c);return 'OK:'+JSON.stringify(x);}catch(e){return 'ERR:'+(e.message||e);}})()")
case "$r" in
  *OK:*success*true*) ok "upsertConfig first-time save → success (Bug #1 guard)" ;;
  *) bad "upsertConfig (first-time)" "got: $r" ;;
esac

# ── getStatus: bridge running + config persisted ─────────────────────
# Return a quote-free token so grep isn't tripped up by agent-browser's
# JSON-string escaping of the eval result.
r=$(ipc_eval "(async()=>{var s=await window.electronAPI.invoke('imessageBridge.getStatus',{});var c=(s.configs||[]).find(function(x){return x.applicationId==='${APP_ID}';});return 'RUN='+(s.running?'Y':'N')+' CFG='+(c?'Y':'N')+' PW='+((c&&c.blueBubblesPasswordSet)?'Y':'N');})()")
echo "$r" | grep -q 'RUN=Y' && ok "bridge running" || bad "bridge running" "got: $r"
echo "$r" | grep -q 'CFG=Y' && ok "config persisted" || bad "config persisted" "got: $r"
echo "$r" | grep -q 'PW=Y'  && ok "password stored (redacted in status)" || bad "password stored" "got: $r"

# ── BlueBubbles webhook actually registered ──────────────────────────
if bb_get_webhooks | grep -q "${APP_ID}"; then
  ok "BlueBubbles webhook registered for appId"
else
  bad "BlueBubbles webhook" "no webhook URL containing ${APP_ID}"
fi

# ── Local bridge HTTP server: secret enforcement ─────────────────────
BRIDGE_URL=$(ipc_eval "(async()=>{var s=await window.electronAPI.invoke('imessageBridge.getStatus',{});return s.serverUrl||'';})()" | tr -d '"')
if [ -n "$BRIDGE_URL" ]; then
  # wrong secret → 401
  code=$(curl -sS -m 6 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    "${BRIDGE_URL}/webhooks/bluebubbles/${APP_ID}?secret=WRONG" \
    -d '{"type":"new-message","data":{"guid":"x"}}' || echo 000)
  [ "$code" = "401" ] && ok "local bridge rejects wrong secret (401)" || bad "local bridge wrong secret" "expected 401, got $code"

  # right secret → passes auth (reaches forward; without a bound cloud bot it
  # returns 5xx — that's fine, we're only asserting auth + routing here)
  code=$(curl -sS -m 6 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    "${BRIDGE_URL}/webhooks/bluebubbles/${APP_ID}?secret=${SECRET}" \
    -d '{"type":"new-message","data":{"guid":"x","text":"hi"}}' || echo 000)
  [ "$code" != "401" ] && ok "local bridge accepts valid secret (HTTP $code, past auth)" || bad "local bridge valid secret" "got 401 with correct secret"
else
  bad "local bridge URL" "getStatus returned no serverUrl"
fi

# ── Cleanup ──────────────────────────────────────────────────────────
ipc_eval "(async()=>{try{await window.electronAPI.invoke('imessageBridge.removeConfig',{applicationId:'${APP_ID}'});await window.electronAPI.invoke('imessageBridge.stop',{});}catch(e){}return 'cleaned';})()" >/dev/null
bb_cleanup_webhooks
note "cleaned up config + BlueBubbles webhook for ${APP_ID}"

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "[imsg-test] PASS=${PASS}  FAIL=${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
