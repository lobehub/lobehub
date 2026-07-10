#!/usr/bin/env bash
# Smoke tests for agent-browser KLM wrapper + analyzer. Uses a stub
# agent-browser, so no real browser is required.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/agent-browser-klm.mjs"
ANALYZER="$SCRIPT_DIR/agent-browser-klm-analyze.mjs"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin"
cat > "$tmp_dir/bin/agent-browser" << 'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${AGENT_BROWSER_STUB_LOG:?}"
SH
chmod +x "$tmp_dir/bin/agent-browser"

export PATH="$tmp_dir/bin:$PATH"
export AGENT_BROWSER_STUB_LOG="$tmp_dir/agent-browser.log"

trace="$tmp_dir/interaction-trace.jsonl"
trace_flags="$tmp_dir/flags-trace.jsonl"
result="$tmp_dir/result.json"

node "$WRAPPER" --klm-trace "$trace" --klm-phase first --klm-check case-1 --session app click @e1
node "$WRAPPER" --klm-trace "$trace" --klm-phase form --klm-check case-1 fill @e2 hello
node "$WRAPPER" --klm-trace "$trace" --klm-phase wait --session app wait 2000
node "$WRAPPER" mental --klm-trace "$trace" --klm-phase first --m 2 --score 3 --confidence 0.75 --reason "first view"
node "$WRAPPER" --klm-trace "$trace_flags" --klm-phase nav --engine chrome --args --no-proxy-server open about:blank

node "$ANALYZER" --trace "$trace" > "$tmp_dir/summary.json"

node - "$tmp_dir/summary.json" << 'JS'
const fs = require('fs');
const summary = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

eq(summary.operators.P, 2, 'P');
eq(summary.operators.K, 1, 'K');
eq(summary.operators.M, 2, 'M');
eq(summary.operators.T_chars, 5, 'T_chars');
eq(summary.operators.R_ms, 2000, 'R_ms');
eq(summary.totalSeconds, 8.1, 'totalSeconds');
eq(summary.activeSeconds, 6.1, 'activeSeconds');
eq(summary.waitSeconds, 2, 'waitSeconds');
eq(summary.phases[0].id, 'first', 'top phase');
JS

cat > "$result" << 'JSON'
{
  "title": "KLM smoke",
  "cases": [],
  "summary": { "total": 0, "passed": 0, "failed": 0, "blocked": 0, "verdict": "pending" }
}
JSON

node "$ANALYZER" --trace "$trace" --result "$result" --write > /dev/null

node - "$result" << 'JS'
const fs = require('fs');
const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!result.interactionCost) throw new Error('interactionCost missing');
if (result.interactionCost.totalSeconds !== 8.1) {
  throw new Error(`unexpected patched total: ${result.interactionCost.totalSeconds}`);
}
JS

grep -Fq -- "--session app click @e1" "$AGENT_BROWSER_STUB_LOG" || fail "wrapper did not forward click"
grep -Fq -- "--engine chrome --args --no-proxy-server open about:blank" "$AGENT_BROWSER_STUB_LOG" ||
  fail "wrapper did not forward global flags"

node - "$trace_flags" << 'JS'
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').trim());
if (event.agentBrowser.command !== 'open') {
  throw new Error(`expected open command, got ${event.agentBrowser.command}`);
}
if (event.klm.category !== 'navigation') {
  throw new Error(`expected navigation category, got ${event.klm.category}`);
}
JS

echo "agent-browser KLM tests passed"
