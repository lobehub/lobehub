#!/usr/bin/env bash
# local-gateway-setup.sh — wire up a LOCAL Agent Gateway for closed-loop E2E.
#
# Why: the ONLINE gateway (agent-gateway.lobehub.com) verifies the browser's
# user JWT against the PRODUCTION app's JWKS. A local dev instance signs that
# JWT with its OWN `JWKS_KEY`, so the online gateway rejects it with
# `auth_failed: signature verification failed`. The server→gateway push still
# works (it uses the static AGENT_GATEWAY_SERVICE_TOKEN), but the browser can
# never receive events — so client/SSE/online-gateway are all "not the real
# closed loop" for local dev.
#
# Fix: run the gateway worker yourself from the SIBLING `agent-gateway/` repo
# via `wrangler dev`, and point its `JWKS_PUBLIC_KEY` at YOUR local app's
# public key. Then the local gateway trusts your local JWT → `auth_success` →
# full browser↔gateway loop, all local.
#
# This script extracts the public JWK from the app's `.env.local` JWKS_KEY,
# reuses the app's AGENT_GATEWAY_SERVICE_TOKEN, and writes `agent-gateway/.dev.vars`.
# It then prints the app-side env you must set + how to start the worker.
#
# Usage (from the lobehub repo root):
#   .agents/acceptance/scripts/agent-gateway/local-gateway-setup.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
GATEWAY_DIR="$(cd "$REPO_ROOT/.." && pwd)/agent-gateway"
PORT="${GATEWAY_PORT:-8787}"

# JWKS_KEY + AGENT_GATEWAY_SERVICE_TOKEN source (do NOT assume .env.local —
# the managed agent-testing flow has no .env.local; the values live in
# .records/env/gateway.env). Override with JWKS_SOURCE=<env file>.
APP_ENV="${JWKS_SOURCE:-}"
if [ -z "$APP_ENV" ]; then
  for cand in "$REPO_ROOT/.records/env/gateway.env" "$REPO_ROOT/.env.local"; do
    [ -f "$cand" ] && { APP_ENV="$cand"; break; }
  done
fi

[ -d "$GATEWAY_DIR" ] || { echo "❌ sibling agent-gateway repo not found at: $GATEWAY_DIR"; echo "   clone it next to lobehub (same parent dir)."; exit 1; }
[ -n "$APP_ENV" ] && [ -f "$APP_ENV" ] || { echo "❌ no env file with JWKS_KEY found (set JWKS_SOURCE=<file>, or create .records/env/gateway.env)"; exit 1; }
echo "ℹ️  reading JWKS_KEY + AGENT_GATEWAY_SERVICE_TOKEN from: $APP_ENV"

node -e '
const fs = require("fs");
const env = fs.readFileSync(process.argv[1], "utf8");
const pick = (k) => { const m = env.match(new RegExp("^"+k+"=(.*)$","m")); return m ? m[1].trim().replace(/^['"'"'"]|['"'"'"]$/g,"") : ""; };
const jwksRaw = pick("JWKS_KEY");
const svc = pick("AGENT_GATEWAY_SERVICE_TOKEN");
if (!jwksRaw) { console.error("❌ JWKS_KEY missing in .env.local"); process.exit(1); }
if (!svc)     { console.error("❌ AGENT_GATEWAY_SERVICE_TOKEN missing in .env.local"); process.exit(1); }
const jwks = JSON.parse(jwksRaw);
// strip private fields → public JWK set (gateway only verifies signatures)
const pub = { keys: jwks.keys.map(k => { const { d, p, q, dp, dq, qi, ...rest } = k; return rest; }) };
fs.writeFileSync(process.argv[2], `JWKS_PUBLIC_KEY=${JSON.stringify(pub)}\nSERVICE_TOKEN=${svc}\n`);
const kid = pub.keys.find(k => k.alg === "RS256")?.kid;
console.log("✅ wrote " + process.argv[2]);
console.log("   JWKS_PUBLIC_KEY kid =", kid, "(public only, no private d)");
console.log("   SERVICE_TOKEN head  =", svc.slice(0, 10) + "…");
' "$APP_ENV" "$GATEWAY_DIR/.dev.vars"

cat <<EOF

── Next steps ─────────────────────────────────────────────────────────────────
1) Start the local gateway worker (separate terminal):
     cd "$GATEWAY_DIR" && bun run dev        # wrangler dev → http://localhost:$PORT
   Sanity: curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:$PORT/health  # → 200

2) Point the APP at the local gateway, then RESTART the dev server:
     AGENT_GATEWAY_URL=http://localhost:$PORT     # client builds ws://localhost:$PORT/ws
     AGENT_GATEWAY_SERVICE_TOKEN=<unchanged>      # same value already in .env.local
     ENABLE_AGENT_GATEWAY=1                       # drives serverConfig.enableGatewayMode

3) In the browser, send a message. Expect the gateway WS to reply
   {"type":"auth_success"} (NOT auth_failed) and stream events.
   Probe auth in isolation with the harness in references/agent-gateway.md.
────────────────────────────────────────────────────────────────────────────────
EOF
