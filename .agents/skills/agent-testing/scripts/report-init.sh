#!/usr/bin/env bash
# report-init.sh — scaffold a structured test report under .records/reports/.
#
# Format spec and evidence rules: ../references/report.md
#
# Usage:
#   report-init.sh <slug> [title]
#
# Prints the report directory path (capture it: DIR=$(report-init.sh my-test)).

set -euo pipefail

SLUG="${1:?Usage: report-init.sh <slug> [title]}"
TITLE="${2:-$SLUG}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
DIR="$REPO_ROOT/.records/reports/$TS-$SLUG"
mkdir -p "$DIR/assets"

BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2> /dev/null || echo "unknown")
COMMIT=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2> /dev/null || echo "unknown")
DATE_HUMAN=$(date '+%Y-%m-%d %H:%M')
DATE_ISO=$(date '+%Y-%m-%dT%H:%M:%S%z')

cat > "$DIR/report.md" << EOF
# Test Report: $TITLE

## Scope

<!-- What changed / what is being verified -->

- Branch: \`$BRANCH\`
- Commit: \`$COMMIT\`
- Date: $DATE_HUMAN

## Environment

- Server: <!-- e.g. http://localhost:3010 -->
- Surfaces: <!-- cli / electron / web / bot:<platform> -->

## Cases

| # | Case | Surface | Steps | Expected | Actual | Status | Evidence |
| - | ---- | ------- | ----- | -------- | ------ | ------ | -------- |
| 1 |      |         |       |          |        |        |          |

## Evidence

<!-- Embed screenshots: ![case 1](assets/case1.png) -->
<!-- CLI transcripts in fenced blocks, with the exact command -->

## Verdict

- Passed: 0 / 0
- Failed: 0
- Blocked: 0
- Score (optional): —
- Open issues / follow-ups:
EOF

cat > "$DIR/result.json" << EOF
{
  "title": "$TITLE",
  "createdAt": "$DATE_ISO",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "surfaces": [],
  "cases": [],
  "summary": { "total": 0, "passed": 0, "failed": 0, "blocked": 0, "verdict": "pending" }
}
EOF

echo "$DIR"
