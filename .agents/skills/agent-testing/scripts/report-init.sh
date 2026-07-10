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

# report.md is rendered as the verify page's "Details" tail — free-form COMMENT.
# The scope (范围), per-case table (用例), overall conclusion, and the score are
# all STRUCTURED on the page now (result.json scenario/context + cases +
# summary.conclusion + summary.score), so DON'T repeat any of them here or they
# double up. Keep only non-duplicate detail: repro commands, caveats, follow-ups.
cat > "$DIR/report.md" << EOF
## 备注 / 说明

<!-- 复现命令、注意事项、仍需跟进项；没有则写“无”。不要贴图片/GIF——视觉证据放在
     result.json 的 cases[].evidence 里，页面会渲染，report.md 里重复会重复展示。 -->

\`\`\`bash
# command
\`\`\`
EOF

# result.json drives the structured page. \`summary.conclusion\` is the overall
# conclusion shown at the top (under the scope block); \`summary.score\` (0-100)
# becomes the \`score\` stat; \`scenario\`/\`context\` fields
# (branch/commit/surfaces/entry/focus) render the scope header.
cat > "$DIR/result.json" << EOF
{
  "title": "$TITLE",
  "scenario": "coding",
  "createdAt": "$DATE_ISO",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "surfaces": [],
  "entry": "",
  "focus": "",
  "cases": [],
  "interactionCost": null,
  "summary": { "total": 0, "passed": 0, "failed": 0, "blocked": 0, "verdict": "pending", "conclusion": "", "score": null }
}
EOF

echo "$DIR"
