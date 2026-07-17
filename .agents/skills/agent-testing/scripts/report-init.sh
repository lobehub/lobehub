#!/usr/bin/env bash
# report-init.sh — scaffold a structured test report under .records/reports/.
#
# Format spec and evidence rules: ../references/report.md
#
# Usage:
#   report-init.sh [--subject <type:id>] <slug> [title]
#
# With --subject (task:<id> | topic:<id> | document:<id>) the run is grouped
# under its acceptance:
#   .records/reports/<type>-<id>/<YYYYMMDD-HHMMSS>-<slug>/
# and the group dir gets an acceptance.json marker (created once, updatedAt
# bumped per run). The subject is also pre-filled into result.json so
# `lh verify ingest-report` attaches the run without an explicit --subject.
#
# Without --subject the legacy flat layout is used:
#   .records/reports/<YYYYMMDD-HHMMSS>-<slug>/
# Every run ultimately needs a subject at ingest time — prefer passing it here.
#
# Prints the report directory path (capture it: DIR=$(report-init.sh my-test)).

set -euo pipefail

SUBJECT=""
if [[ "${1:-}" == "--subject" ]]; then
  SUBJECT="${2:?--subject requires a value like topic:tpc_xxx}"
  shift 2
fi

SLUG="${1:?Usage: report-init.sh [--subject <type:id>] <slug> [title]}"
TITLE="${2:-$SLUG}"

# Anchor to the checkout being TESTED (cwd's git toplevel — correct when the
# main checkout's script is invoked inside a worktree); fall back to the
# script's own checkout outside any repo.
REPO_ROOT="$(git rev-parse --show-toplevel 2> /dev/null || { cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd; })"
TS="$(date +%Y%m%d-%H%M%S)"

SUBJECT_JSON="null"
if [[ -n "$SUBJECT" ]]; then
  if [[ ! "$SUBJECT" =~ ^(task|topic|document):.+$ ]]; then
    echo "report-init.sh: --subject must be task:<id> | topic:<id> | document:<id>, got '$SUBJECT'" >&2
    exit 1
  fi
  SUBJECT_KEY="${SUBJECT/:/-}"
  GROUP_DIR="$REPO_ROOT/.records/reports/$SUBJECT_KEY"
  DIR="$GROUP_DIR/$TS-$SLUG"
  SUBJECT_JSON="\"$SUBJECT\""
else
  DIR="$REPO_ROOT/.records/reports/$TS-$SLUG"
fi
mkdir -p "$DIR/assets"

BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2> /dev/null || echo "unknown")
COMMIT=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2> /dev/null || echo "unknown")
DATE_ISO=$(date '+%Y-%m-%dT%H:%M:%S%z')

# acceptance.json marks the group dir: what acceptance these runs belong to.
# Created on the first run; only updatedAt/lastRun move afterwards (the title
# from the first scaffold wins — it names the acceptance, not the round).
if [[ -n "$SUBJECT" ]]; then
  ACCEPTANCE_JSON="$GROUP_DIR/acceptance.json"
  if [[ ! -f "$ACCEPTANCE_JSON" ]]; then
    cat > "$ACCEPTANCE_JSON" << EOF
{
  "subject": "$SUBJECT",
  "title": "$TITLE",
  "createdAt": "$DATE_ISO",
  "updatedAt": "$DATE_ISO",
  "lastRun": "$TS-$SLUG"
}
EOF
  else
    node -e '
      const fs = require("fs");
      const [file, ts, iso] = process.argv.slice(1);
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      data.updatedAt = iso;
      data.lastRun = ts;
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    ' "$ACCEPTANCE_JSON" "$TS-$SLUG" "$DATE_ISO"
  fi
fi

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
  "title": "$TITLE",
  "scenario": "coding",
  "createdAt": "$DATE_ISO",
  "subject": $SUBJECT_JSON,
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "surfaces": [],
  "entry": "",
  "plan": [],
  "cases": [],
  "interactionCost": null,
  "summary": { "total": 0, "passed": 0, "failed": 0, "blocked": 0, "verdict": "pending", "conclusion": "", "score": null }
}
EOF

echo "$DIR"
