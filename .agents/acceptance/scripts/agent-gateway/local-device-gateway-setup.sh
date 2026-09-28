#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
GATEWAY_DIR="$(cd "$REPO_ROOT/.." && pwd)/device-gateway"
APP_ENV="${JWKS_SOURCE:-$REPO_ROOT/.records/env/gateway.env}"

[ -d "$GATEWAY_DIR" ] || { echo "device-gateway repo not found: $GATEWAY_DIR"; exit 1; }
[ -f "$APP_ENV" ] || { echo "gateway env not found: $APP_ENV"; exit 1; }

set -a
# shellcheck disable=SC1090
source "$APP_ENV"
set +a

node -e '
const fs = require("fs");
const jwks = JSON.parse(process.env.JWKS_KEY || "{}");
const serviceToken = process.env.DEVICE_GATEWAY_SERVICE_TOKEN;
if (!serviceToken || !Array.isArray(jwks.keys)) process.exit(1);
const publicKeys = jwks.keys.map(({ d, p, q, dp, dq, qi, ...key }) => key);
fs.writeFileSync(process.argv[1], `SERVICE_TOKEN=${serviceToken}\nJWKS_PUBLIC_KEY=${JSON.stringify({ keys: publicKeys })}\n`);
' "$GATEWAY_DIR/.dev.vars"

echo "configured local device gateway: $GATEWAY_DIR/.dev.vars"
