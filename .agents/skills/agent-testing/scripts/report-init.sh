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
# 测试报告：$TITLE

## 范围

<!-- 测试目标 / 变更范围 / 重点风险 -->

- 分支：\`$BRANCH\`
- 当前提交：\`$COMMIT\`
- 日期：$DATE_HUMAN
- 表面：<!-- CLI / Electron + CDP / Web / Bot:<platform> -->
- 测试页 / 入口：<!-- e.g. /settings or http://localhost:3010 -->
- 重点：<!-- 本轮最关心的体验、功能或回归点 -->

## 用例

| # | 用例 | 结果 | 关键现象 | 证据 |
| - | ---- | ---- | -------- | ---- |
| 1 |      | 待测 |          | ![用例 1](assets/case1.png) |

## 结论

整体结论：\`pending\`。

<!-- 用 1-2 段概括用户最需要知道的结果；失败和阻塞必须明确说明影响。 -->

仍需处理 / 跟进：

- <!-- TODO -->

## 本轮验证

<!-- 如有自动化或命令行验证，保留精简命令与结果；没有则写“未运行额外自动化验证”。 -->

\`\`\`bash
# command
\`\`\`

结果：

- <!-- TODO -->

## 评分

- 通过：0
- 失败：0
- 阻塞：0
- 评分：— / 100
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
