#!/usr/bin/env bash
# OpenResponses Compliance Test Runner
# Clones the official test suite locally and runs it against a local server.
#
# Usage:
#   ./scripts/compliance-test.sh                          # uses APP_URL env var
#   ./scripts/compliance-test.sh --filter basic-response  # filter tests
#   ./scripts/compliance-test.sh --base-url http://localhost:3010/api/v1 --api-key <key>
#
# Environment variables:
#   APP_URL    - App base URL (default: http://localhost:3010), auto-appends /api/v1
#   API_KEY    - API key for authentication
#
# All flags are forwarded to the upstream CLI (run with --help to see all options).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="https://github.com/openresponses/openresponses.git"
CACHE_DIR="$SCRIPT_DIR/openresponses-compliance"
BRANCH="main"

# Clone or update the test suite
if [ -d "$CACHE_DIR/.git" ]; then
  echo "Updating cached test suite..."
  git -C "$CACHE_DIR" fetch --depth 1 origin "$BRANCH" --quiet
  git -C "$CACHE_DIR" checkout FETCH_HEAD --quiet
else
  echo "Cloning test suite (one-time)..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CACHE_DIR" --quiet
fi

# Install deps (bun is fast, skips if lock unchanged)
cd "$CACHE_DIR"
bun install --frozen-lockfile --silent 2>/dev/null || bun install --silent

# Build default args from env vars (can be overridden by explicit flags)
DEFAULT_ARGS=()

# Auto-detect --base-url from APP_URL if not explicitly provided
if ! echo "$@" | grep -q -- "--base-url\|-u"; then
  BASE_URL="${APP_URL:-http://localhost:3010}/api/v1"
  DEFAULT_ARGS+=(--base-url "$BASE_URL")
fi

# Auto-detect --api-key from API_KEY if not explicitly provided
if ! echo "$@" | grep -q -- "--api-key\|-k"; then
  if [ -n "${API_KEY:-}" ]; then
    DEFAULT_ARGS+=(--api-key "$API_KEY")
  fi
fi

# Run the compliance test CLI
exec bun run bin/compliance-test.ts "${DEFAULT_ARGS[@]}" "$@"
