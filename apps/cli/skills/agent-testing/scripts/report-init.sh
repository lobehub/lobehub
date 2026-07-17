#!/usr/bin/env bash
# report-init.sh — scaffold a structured test report under .records/reports/.
#
# Format spec and evidence rules: ../references/report.md
#
# Usage:
#   report-init.sh <slug> [title]
#
# Run this from the CONSUMER repo root — the report is created relative to the
# current working directory, not relative to this script's own location.
#
# Prints the report directory path (capture it: DIR=$(report-init.sh my-test)).

set -euo pipefail

SLUG="${1:?Usage: report-init.sh <slug> [title]}"
TITLE="${2:-$SLUG}"

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

REPO_ROOT="$(pwd)"
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
# conclusion shown at the top (under the title); \`summary.score\` (0-100) becomes
# the \`score\` stat; branch/commit/surfaces/entry render the one-line provenance.
#
# \`plan\` is filled BEFORE the run: {id, title, method, expected} per check. It
# shares ids with \`cases\`, so the page pairs intent against outcome and shows a
# planned item that never ran as 未执行 rather than dropping it.
#
# \`surfaces\` is a closed set: web | desktop | cli | mobile | bot. It is where a
# check RAN — not a test kind (unit/backend) and not a runtime mode (packaged
# build / CDP dev instance; that goes on the plan item's \`method\`).
cat > "$DIR/result.json" << EOF
{
  "title": "$(json_escape "$TITLE")",
  "scenario": "coding",
  "createdAt": "$(json_escape "$DATE_ISO")",
  "branch": "$(json_escape "$BRANCH")",
  "commit": "$(json_escape "$COMMIT")",
  "surfaces": [],
  "entry": "",
  "plan": [],
  "cases": [],
  "interactionCost": null,
  "summary": { "total": 0, "passed": 0, "failed": 0, "blocked": 0, "verdict": "pending", "conclusion": "", "score": null }
}
EOF

echo "$DIR"
