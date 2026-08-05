#!/usr/bin/env bash
# Build the design-prototype runtime (real design system, bundled once) and
# vendor babel-standalone next to it, so prototypes are single HTML files that
# run offline over file://.
#
# Usage:
#   bash .agents/skills/design-prototype/scripts/build-runtime.sh [out-dir]
# Default out-dir: <skill>/assets  (gitignored artifacts)
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
OUT_DIR="${1:-$SKILL_DIR/assets}"
mkdir -p "$OUT_DIR"

# esbuild ships as a transitive dep (vite); pick the newest copy in the pnpm store.
ESBUILD="$(ls -d "$REPO_ROOT"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | sort -V | tail -1)"

cd "$REPO_ROOT"
"$ESBUILD" "$SKILL_DIR/assets/entry.mjs" \
  --bundle --format=iife --global-name=__PROTO_DEPS_NS__ \
  --platform=browser --define:process.env.NODE_ENV='"production"' --minify \
  --loader:.css=empty --loader:.woff=dataurl --loader:.woff2=dataurl \
  --loader:.svg=dataurl --loader:.png=dataurl \
  --outfile="$OUT_DIR/lobe-prototype-runtime.js"

# Vendor babel-standalone (pinned) for offline JSX compilation.
BABEL="$OUT_DIR/babel.min.js"
if [ ! -s "$BABEL" ]; then
  curl -fsSL "https://unpkg.com/@babel/standalone@7.26.4/babel.min.js" -o "$BABEL"
fi

ls -lh "$OUT_DIR/lobe-prototype-runtime.js" "$BABEL" | awk '{print $5, $NF}'
echo "done → $OUT_DIR"
